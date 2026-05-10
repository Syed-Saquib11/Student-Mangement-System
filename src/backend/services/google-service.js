// src/backend/services/google-service.js
// Handles all Google OAuth2 flow, token refresh, and user profile fetching.
// Runs in the main process only — never require this from the renderer.

'use strict';

const http = require('http');
const url = require('url');
const { shell } = require('electron');
const { google } = require('googleapis');

const tokenModel = require('../models/google-token-model');

// ── Credentials ──────────────────────────────────────────────────────────────
// Read from .env via process.env — make sure dotenv is loaded in main.js
// before this service is ever called. Expected keys:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET

function loadCredentials() {
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!client_id || !client_secret) return null;
    return { client_id, client_secret };
}

// ── Scopes ────────────────────────────────────────────────────────────────────
const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/forms.responses.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

// ── Port finder ───────────────────────────────────────────────────────────────
// Tries ports 3000–3004 and returns the first one not already in use.
function findAvailablePort() {
    const PORTS = [3000, 3001, 3002, 3003, 3004];

    return new Promise((resolve, reject) => {
        let index = 0;

        function tryNext() {
            if (index >= PORTS.length) {
                return reject(new Error('No available port found in range 3000–3004.'));
            }

            const port = PORTS[index++];
            const testServer = http.createServer();

            testServer.once('error', () => tryNext());
            testServer.once('listening', () => {
                testServer.close(() => resolve(port));
            });
            testServer.listen(port, '127.0.0.1');
        }

        tryNext();
    });
}

// ── OAuth2 client factory ─────────────────────────────────────────────────────
function makeOAuth2Client(credentials, redirectUri) {
    return new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        redirectUri
    );
}

// ── User profile fetch ────────────────────────────────────────────────────────
async function fetchUserProfile(oauth2Client) {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    return {
        email: data.email || '',
        name: data.name || '',
        avatar: data.picture || '',
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getStatus()
 * Returns current connection state from saved tokens — no network call.
 * @returns {{ connected: boolean, email: string, name: string, avatar: string }}
 */
function getStatus() {
    if (!tokenModel.hasTokens()) {
        return { connected: false, email: '', name: '', avatar: '' };
    }

    const tokens = tokenModel.loadTokens();
    if (!tokens || !tokens.refresh_token) {
        return { connected: false, email: '', name: '', avatar: '' };
    }

    return {
        connected: true,
        email: tokens.email || '',
        name: tokens.name || '',
        avatar: tokens.avatar || '',
    };
}

/**
 * connect()
 * Full OAuth flow: opens browser → catches callback → exchanges code → saves tokens.
 * @returns {{ success: boolean, email?: string, name?: string, avatar?: string, error?: string }}
 */
async function connect() {
    // 1. Load credentials
    const credentials = loadCredentials();
    if (!credentials || !credentials.client_id || !credentials.client_secret) {
        return { success: false, error: 'Google credentials not configured. Please add data/google-credentials.json.' };
    }

    try {
        // 2. Find an available port
        const port = await findAvailablePort();
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        // 3. Build OAuth2 client and auth URL
        const oauth2Client = makeOAuth2Client(credentials, redirectUri);
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: SCOPES,
        });

        // 4. Start temporary callback server and open browser — concurrently
        const code = await new Promise((resolve, reject) => {
            let settled = false;

            // Timeout after 5 minutes
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    server.close();
                    reject(new Error('Login timed out after 5 minutes. Please try again.'));
                }
            }, 5 * 60 * 1000);

            const server = http.createServer((req, res) => {
                if (settled) return;

                const parsed = url.parse(req.url, true);
                const authCode = parsed.query.code;
                const authErr = parsed.query.error;

                if (parsed.pathname !== '/callback' || (!authCode && !authErr)) {
                    // Ignore non-callback requests (e.g. favicon)
                    res.writeHead(404);
                    res.end();
                    return;
                }

                settled = true;
                clearTimeout(timeout);

                // Send a response page so the browser tab doesn't hang
                res.writeHead(200, { 'Content-Type': 'text/html' });
                if (authCode) {
                    res.end(`
            <html><body style="font-family:sans-serif;text-align:center;padding:60px">
              <h2>✅ Connected!</h2>
              <p>You can close this tab and return to DATAFLOW.</p>
            </body></html>
          `);
                    server.close(() => resolve(authCode));
                } else {
                    res.end(`
            <html><body style="font-family:sans-serif;text-align:center;padding:60px">
              <h2>❌ Connection failed</h2>
              <p>${authErr || 'Unknown error'}. You can close this tab.</p>
            </body></html>
          `);
                    server.close(() => reject(new Error(`Google auth error: ${authErr}`)));
                }
            });

            server.listen(port, '127.0.0.1', () => {
                // 5. Open browser after server is ready
                shell.openExternal(authUrl).catch(err => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timeout);
                        server.close();
                        reject(new Error(`Could not open browser: ${err.message}`));
                    }
                });
            });

            server.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error(`Callback server error: ${err.message}`));
                }
            });
        });

        // 6. Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // 7. Fetch user profile
        const profile = await fetchUserProfile(oauth2Client);

        // 8. Save tokens + profile info together
        tokenModel.saveTokens({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date,
            email: profile.email,
            name: profile.name,
            avatar: profile.avatar,
        });

        return { success: true, ...profile };

    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * disconnect()
 * Removes saved tokens from disk.
 * @returns {{ success: boolean }}
 */
function disconnect() {
    try {
        tokenModel.clearTokens();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * getValidAccessToken()
 * Returns a valid access token, refreshing silently if expired.
 * Used internally by future Drive / Forms / Sheets service calls.
 * @returns {Promise<string>} access_token
 * @throws if no tokens saved or refresh fails
 */
async function getValidAccessToken() {
    const tokens = tokenModel.loadTokens();
    if (!tokens || !tokens.refresh_token) {
        throw new Error('Not connected to Google. Please connect from Settings.');
    }

    const credentials = loadCredentials();
    if (!credentials) {
        throw new Error('Google credentials not configured.');
    }

    // Use a dummy redirect URI here — only needed during the initial auth flow
    const oauth2Client = makeOAuth2Client(credentials, 'http://127.0.0.1');
    oauth2Client.setCredentials(tokens);

    // Check expiry — refresh if within 60 seconds of expiry
    const BUFFER_MS = 60 * 1000;
    const needsRefresh = !tokens.expiry_date || Date.now() >= (tokens.expiry_date - BUFFER_MS);

    if (needsRefresh) {
        try {
            const { credentials: newTokens } = await oauth2Client.refreshAccessToken();

            // Preserve refresh_token (Google only sends it on first auth)
            tokenModel.saveTokens({
                ...tokens,
                access_token: newTokens.access_token,
                expiry_date: newTokens.expiry_date,
                // refresh_token: keep existing unless Google sent a new one
                ...(newTokens.refresh_token ? { refresh_token: newTokens.refresh_token } : {}),
            });

            return newTokens.access_token;
        } catch (refreshErr) {
            console.error('[GoogleService] Token refresh failed:', refreshErr.message);
            // If the refresh token is revoked/expired, clear stale tokens
            // so the next connect() call does a fresh OAuth flow.
            if (refreshErr.message && (
                refreshErr.message.includes('invalid_grant') ||
                refreshErr.message.includes('Token has been expired or revoked')
            )) {
                tokenModel.clearTokens();
                throw new Error('Google session expired. Please reconnect your Google account.');
            }
            throw refreshErr;
        }
    }

    return tokens.access_token;
}

async function getDriveFiles() {
    const token = await getValidAccessToken();
    const oAuth2Client = new google.auth.OAuth2();
    oAuth2Client.setCredentials({ access_token: token });
    
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    
    try {
        const response = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.spreadsheet'",
            fields: 'files(id, name, modifiedTime)',
            orderBy: 'modifiedTime desc',
            pageSize: 50
        });
        return response.data.files || [];
    } catch (error) {
        throw new Error('Failed to load Google Drive files: ' + error.message);
    }
}

module.exports = {
    getStatus,
    connect,
    disconnect,
    getValidAccessToken,
    getDriveFiles
};