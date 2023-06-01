import { AnonymousMedTechApiBuilder, AnonymousMedTechApi, MedTechApiBuilder, User, MedTechApi } from "@icure/medical-device-sdk";
import { AuthenticationProcess } from "@icure/medical-device-sdk/src/models/AuthenticationProcess";
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { revertAll, setSavedCredentials } from "../app/config";
import storage from "../app/storage";

const apiCache: { [key: string]: MedTechApi | AnonymousMedTechApi } = {};

export interface MedTechApiState {
    email?: string;
    token?: string;
    user?: User;
    keyPair?: { publicKey: string; privateKey: string };
    authProcess?: AuthenticationProcess;
    online: boolean;
    invalidEmail: boolean;
    invalidToken: boolean;
    waitingForToken: boolean;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: number;
    mobilePhone?: string;
}

const initialState: MedTechApiState = {
    email: undefined,
    token: undefined,
    user: undefined,
    keyPair: undefined,
    authProcess: undefined,
    online: false,
    invalidEmail: false,
    invalidToken: false,
    waitingForToken: false,
    firstName: undefined,
    lastName: undefined,
    dateOfBirth: undefined,
    mobilePhone: undefined,
};

export const startAuthentication = createAsyncThunk('medTechApi/startAuthentication', async (_payload: { captchaToken: string }, { getState }) => {
    const {
        auth: { email, firstName, lastName },
    } = getState() as { auth: MedTechApiState };

    if (!email) {
        throw new Error('No email provided');
    }

    const anonymousApi = await new AnonymousMedTechApiBuilder()
        .withCrypto(crypto)
        .withMsgGwSpecId(process.env.REACT_APP_EXTERNAL_SERVICES_SPEC_ID!)
        .withAuthProcessByEmailId(process.env.REACT_APP_EMAIL_AUTHENTICATION_PROCESS_ID!)
        .withAuthProcessBySmsId(process.env.REACT_APP_SMS_AUTHENTICATION_PROCESS_ID!)
        .withStorage(storage)
        .preventCookieUsage()
        .build();

    const authProcess = await anonymousApi.authenticationApi.startAuthentication(_payload.captchaToken, email, undefined, firstName, lastName, process.env.REACT_APP_PARENT_ORGANISATION_ID, undefined, undefined, 'friendly-captcha');

    apiCache[`${authProcess.login}/${authProcess.requestId}`] = anonymousApi;

    return authProcess;
});

export const completeAuthentication = createAsyncThunk('medTechApi/completeAuthentication', async (_payload, { getState, dispatch }) => {
    const {
        auth: { authProcess, token },
    } = getState() as { auth: MedTechApiState };

    if (!authProcess) {
        throw new Error('No authProcess provided');
    }

    if (!token) {
        throw new Error('No token provided');
    }

    const anonymousApi = apiCache[`${authProcess.login}/${authProcess.requestId}`] as AnonymousMedTechApi;
    const result = await anonymousApi.authenticationApi.completeAuthentication(authProcess, token);
    const api = result.medTechApi;
    const user = await api.userApi.getLoggedUser();

    apiCache[`${result.groupId}/${result.userId}`] = api;
    delete apiCache[`${authProcess.login}/${authProcess.requestId}`];

    dispatch(setSavedCredentials({ login: `${result.groupId}/${result.userId}`, token: result.token, tokenTimestamp: +Date.now() }));

    return user?.marshal();
});

export const login = createAsyncThunk('medTechApi/login', async (_, { getState }) => {
    const {
        auth: { email, token },
    } = getState() as { auth: MedTechApiState };

    if (!email) {
        throw new Error('No email provided');
    }

    if (!token) {
        throw new Error('No token provided');
    }

    const api = await new MedTechApiBuilder()
        .withCrypto(crypto)
        .withMsgGwSpecId(process.env.REACT_APP_EXTERNAL_SERVICES_SPEC_ID!)
        .withAuthProcessByEmailId(process.env.REACT_APP_EMAIL_AUTHENTICATION_PROCESS_ID!)
        .withAuthProcessBySmsId(process.env.REACT_APP_SMS_AUTHENTICATION_PROCESS_ID!)
        .withStorage(storage)
        .preventCookieUsage()
        .withUserName(email)
        .withPassword(token)
        .build();
    await api.initUserCrypto();
    const user = await api.userApi.getLoggedUser();

    apiCache[`${user.groupId}/${user.id}`] = api;

    return user?.marshal();
});

export const logout = createAsyncThunk('medTechApi/logout', async (_payload, {dispatch}) => {
    dispatch(revertAll());
    dispatch(resetCredentials());
  });

export const api = createSlice({
    name: 'medTechApi',
    initialState,
    reducers: {
        setRegistrationInformation: (state, { payload: { firstName, lastName, email } }: PayloadAction<{ firstName: string; lastName: string; email: string }>) => {
            state.firstName = firstName;
            state.lastName = lastName;
            state.email = email;
        },
        setToken: (state, { payload: { token } }: PayloadAction<{ token: string }>) => {
            state.token = token;
            state.invalidToken = false;
        },
        setEmail: (state, { payload: { email } }: PayloadAction<{ email: string }>) => {
            state.email = email;
            state.invalidEmail = false;
        },
        setUser: (state, {payload: {user}}: PayloadAction<{user: User}>) => {
            state.user = user;
        },
        resetCredentials: (state) => {
            state.online = false;
        },
    },
    extraReducers: builder => {
        builder.addCase(startAuthentication.fulfilled, (state, { payload: authProcess }) => {
            state.authProcess = authProcess;
            state.waitingForToken = true;
        });
        builder.addCase(startAuthentication.rejected, (state, {}) => {
            state.invalidEmail = true;
        });
        builder.addCase(completeAuthentication.fulfilled, (state, { payload: user }) => {
            state.user = user as User;
            state.online = true;
            state.waitingForToken = false;
        });
        builder.addCase(completeAuthentication.rejected, (state, {}) => {
            state.invalidToken = true;
        });
        builder.addCase(login.fulfilled, (state, { payload: user }) => {
            state.user = user as User;
            state.online = true;
        });
        builder.addCase(login.rejected, (state, {}) => {
            state.invalidToken = true;
            state.online = false;
        });
    },
});



export const { setRegistrationInformation, setToken, setEmail, setUser, resetCredentials } = api.actions;

