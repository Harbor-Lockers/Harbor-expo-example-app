import axios from 'axios';
import Config from '../credentials';
import { Locker } from './types';

type TokenResponse = {
  access_token: string;
  token_type: string;
};

type SDKTokenResponse = {
  access_token: string;
};

type Credentials = {
  api_access_token: string;
  token_type: string;
  sdk_token: string;
};

type DropOffToken = {
  payload_auth: string;
  payload: string;
};

const loginURL = (): string => {
  switch (Config.SDK_ENV) {
    case 'production':
      return '.';
    case 'sandbox':
      return '.sandbox.';
    case 'development':
      return '.dev.';
    default:
      throw new Error(`Unknown SDK_ENV: ${Config.SDK_ENV}`);
  }
};

const BASE_URL = `https://api${loginURL()}harborlockers.com/api/v1/`;
const BASE_LOGIN = `https://accounts${loginURL()}harborlockers.com/realms/harbor/protocol/openid-connect/token`;

export const retrieveCredentials = async (
  name: string,
  secret: string,
): Promise<Credentials> => {
  try {
    const requestOptions = {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    };

    const encodedBody = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'service_provider tower_access',
      client_id: name,
      client_secret: secret,
    });

    const response = await axios.post<TokenResponse>(
      BASE_LOGIN,
      encodedBody,
      requestOptions,
    );

    const sdkTokenResponse = await authorizeCredentials(response.data.access_token);

    return {
      api_access_token: response.data.access_token,
      token_type: response.data.token_type,
      sdk_token: sdkTokenResponse.access_token,
    };
  } catch (error) {
    console.log('retrieve credentials failed');
    throw error;
  }
};

async function authorizeCredentials(
  bearerToken: string,
): Promise<SDKTokenResponse> {
  try {
    const authorizeEndpoint = `${BASE_URL}login/authorize`;
    const requestOptionsAuth = {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
    };

    const reqBody = { userId: 'My test Run' };

    const response = await axios.post<SDKTokenResponse>(
      authorizeEndpoint,
      reqBody,
      requestOptionsAuth,
    );

    return response.data;
  } catch (error) {
    throw error;
  }
}

export async function getLockersInTower(
  towerId: string,
  bearerToken: string,
): Promise<Locker[]> {
  try {
    const getLockerDataEndpoint = `${BASE_URL}towers/${towerId.toLowerCase()}/lockers`;
    const requestOptionsAuth = {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
    };

    const response = await axios.get<Locker[]>(
      getLockerDataEndpoint,
      requestOptionsAuth,
    );

    const availableLockersForDropOff = response.data.filter(
      locker => locker.status?.name === 'available',
    );

    return availableLockersForDropOff;
  } catch (error) {
    throw error;
  }
}

export async function createDropOffToken(
  towerId: string,
  lockerId: string,
  bearerToken: string,
): Promise<DropOffToken> {
  try {
    const createDropOffEndpoint = `${BASE_URL}towers/${towerId}/lockers/${lockerId}/dropoff-locker-tokens`;

    const requestOptionsAuth = {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
    };

    const requestBody = { client_info: 'demo open locker', duration: 3000 };

    const response = await axios.post<DropOffToken>(
      createDropOffEndpoint,
      requestBody,
      requestOptionsAuth,
    );

    return {
      payload_auth: response.data.payload_auth,
      payload: response.data.payload,
    };
  } catch (error) {
    throw error;
  }
}
