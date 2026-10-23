/**
 * The Harbor cloud API calls used by the demo flow: client-credentials login,
 * SDK token, lockers of a tower, drop-off token. Plain HTTPS – these work in
 * every runtime (including Expo Go); only the tower commands need the SDK.
 */

import Config from '../credentials';

export type Credentials = {
  api_access_token: string;
  token_type: string;
  sdk_token: string;
};

export type Locker = {
  id: string;
  name: string;
  status?: { name: string; [key: string]: unknown };
  /** The API returns more fields than the demo uses; they are kept for diagnostics. */
  [key: string]: unknown;
};

export type DropOffToken = {
  payload: string;
  payload_auth: string;
};

export class HarborApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'HarborApiError';
  }
}

const ENV_SUBDOMAIN: Record<string, string> = {
  production: '.',
  sandbox: '.sandbox.',
  development: '.dev.',
};

/** Resolved lazily so a bad SDK_ENV produces a readable error on use, not a crash at startup. */
function subdomain(): string {
  const env = String(Config.SDK_ENV ?? '').trim().toLowerCase();
  const value = ENV_SUBDOMAIN[env];
  if (!value) {
    throw new HarborApiError(
      `SDK_ENV in credentials.ts is "${Config.SDK_ENV}"; it must be one of ${Object.keys(ENV_SUBDOMAIN).join(', ')}.`
    );
  }
  return value;
}

const apiUrl = (path: string) => `https://api${subdomain()}harborlockers.com/api/v1/${path}`;
const loginUrl = () =>
  `https://accounts${subdomain()}harborlockers.com/realms/harbor/protocol/openid-connect/token`;

async function request<T>(what: string, url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new HarborApiError(`${what}: no response from the Harbor API (${String(error)}). Are you online?`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const body = JSON.parse(text) as { error_description?: string; detail?: unknown };
      detail = body.error_description ?? (typeof body.detail === 'string' ? body.detail : text);
    } catch {
      /* not JSON */
    }
    const hint =
      response.status === 401 || response.status === 403
        ? ' Check CLIENT_ID / CLIENT_SECRET / SDK_ENV in credentials.ts.'
        : '';
    throw new HarborApiError(`${what}: HTTP ${response.status} \u2013 ${detail}.${hint}`, response.status);
  }
  return JSON.parse(text) as T;
}

const json = (bearerToken: string) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: `Bearer ${bearerToken}`,
});

/** Client-credentials login, then exchange the API token for an SDK token. */
export async function retrieveCredentials(clientId: string, clientSecret: string): Promise<Credentials> {
  if (!clientId || !clientSecret) {
    throw new HarborApiError('CLIENT_ID and CLIENT_SECRET are empty. Fill them in credentials.ts.');
  }
  const token = await request<{ access_token: string; token_type: string }>(
    'Login failed',
    loginUrl(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'service_provider tower_access',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    }
  );
  const sdk = await request<{ access_token: string }>('Getting the SDK token failed', apiUrl('login/authorize'), {
    method: 'POST',
    headers: json(token.access_token),
    body: JSON.stringify({ userId: 'My test Run' }),
  });
  return { api_access_token: token.access_token, token_type: token.token_type, sdk_token: sdk.access_token };
}

/** Every locker of the tower as the API returns it (any status, all fields). */
export function getAllLockersInTower(towerId: string, bearerToken: string): Promise<Locker[]> {
  return request<Locker[]>('Loading lockers failed', apiUrl(`towers/${towerId.toLowerCase()}/lockers`), {
    headers: json(bearerToken),
  });
}

/** A token the tower accepts to open `lockerId` for a drop-off. */
export function createDropOffToken(towerId: string, lockerId: string, bearerToken: string): Promise<DropOffToken> {
  return request<DropOffToken>(
    'Creating the drop-off token failed',
    apiUrl(`towers/${towerId.toLowerCase()}/lockers/${lockerId}/dropoff-locker-tokens`),
    {
      method: 'POST',
      headers: json(bearerToken),
      body: JSON.stringify({ client_info: 'demo open locker', duration: 3000 }),
    }
  );
}
