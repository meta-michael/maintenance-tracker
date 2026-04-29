const { google } = require('googleapis');
const { shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

function credentialsExist() {
  return fs.existsSync(CREDENTIALS_PATH);
}

function readCredentials() {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const src = raw.installed || raw.web || raw;
    return { clientId: src.client_id, clientSecret: src.client_secret };
  } catch {
    return null;
  }
}

function startOAuthFlow(saveToken) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out. Please try again.'));
    }, 5 * 60 * 1000);

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const creds = readCredentials();

      if (!creds) {
        clearTimeout(timer);
        server.close();
        return reject(new Error('google-credentials.json not found'));
      }

      const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
      });

      shell.openExternal(authUrl);

      server.once('request', async (req, res) => {
        clearTimeout(timer);
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(code
          ? `<!DOCTYPE html><html><head><style>
               body{font-family:system-ui;text-align:center;padding:60px;background:#0f172a;color:#f1f5f9}
               h2{color:#22c55e}p{color:#94a3b8}
             </style></head><body>
               <h2>&#10003; Connected!</h2>
               <p>Google Calendar is now connected to Maintenance Tracker.</p>
               <p>You can close this tab.</p>
             </body></html>`
          : `<!DOCTYPE html><html><head><style>
               body{font-family:system-ui;text-align:center;padding:60px;background:#0f172a;color:#f1f5f9}
               h2{color:#ef4444}p{color:#94a3b8}
             </style></head><body>
               <h2>Authorization failed</h2>
               <p>${error || 'Unknown error'}. Please try again.</p>
             </body></html>`
        );
        server.close();

        if (error) return reject(new Error(error));
        if (!code) return reject(new Error('No authorization code received'));

        try {
          const { tokens } = await client.getToken(code);
          saveToken(JSON.stringify(tokens));
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    server.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function getAuthedClient(tokenJson, saveToken) {
  const creds = readCredentials();
  if (!creds || !tokenJson) return null;

  const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  const tokens = JSON.parse(tokenJson);
  client.setCredentials(tokens);

  client.on('tokens', (newTokens) => {
    saveToken(JSON.stringify({ ...tokens, ...newTokens }));
  });

  return client;
}

async function syncVehicleToCalendar(auth, vehicleName, upcoming, existingEventIds) {
  const cal = google.calendar({ version: 'v3', auth });
  const synced = [];
  const errors = [];

  for (const svc of upcoming) {
    if (!svc.due_date) continue;

    const resource = {
      summary: `${svc.name} – ${vehicleName}`,
      description: [
        `Vehicle: ${vehicleName}`,
        `Interval: every ${svc.interval_miles.toLocaleString()} miles`,
        svc.next_due_mileage ? `Due at: ~${svc.next_due_mileage.toLocaleString()} miles` : '',
        svc.last_service_date
          ? `Last service: ${svc.last_service_date} at ${svc.last_service_mileage?.toLocaleString()} mi`
          : 'No prior service recorded',
      ].filter(Boolean).join('\n'),
      start: { date: svc.due_date },
      end: { date: svc.due_date },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10080 }],
      },
    };

    try {
      const existingId = existingEventIds[svc.service_type];
      let eventId;

      if (existingId) {
        try {
          const res = await cal.events.update({
            calendarId: 'primary',
            eventId: existingId,
            requestBody: resource,
          });
          eventId = res.data.id;
        } catch (e) {
          if (e.code === 404 || e.status === 404) {
            const res = await cal.events.insert({ calendarId: 'primary', requestBody: resource });
            eventId = res.data.id;
          } else throw e;
        }
      } else {
        const res = await cal.events.insert({ calendarId: 'primary', requestBody: resource });
        eventId = res.data.id;
      }

      synced.push({ service_type: svc.service_type, event_id: eventId });
    } catch (e) {
      errors.push({ service_type: svc.service_type, error: e.message });
    }
  }

  return { synced, errors };
}

module.exports = { credentialsExist, startOAuthFlow, getAuthedClient, syncVehicleToCalendar };
