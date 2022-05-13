import * as types from '../constants/monitorSla';
import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import ErrorPayload from 'CommonUI/src/PayloadTypes/error';
import PositiveNumber from 'Common/Types/PositiveNumber';

export const createMonitorSlaRequest: Function = (): void => {
    return {
        type: types.CREATE_MONITOR_SLA_REQUEST,
    };
};

export const createMonitorSlaSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.CREATE_MONITOR_SLA_SUCCESS,
        payload,
    };
};

export const createMonitorSlaFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.CREATE_MONITOR_SLA_FAILURE,
        payload: error,
    };
};

export const createMonitorSla: $TSFixMe = (
    projectId: ObjectID,
    data: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(createMonitorSlaRequest());

            const response: $TSFixMe = await BackendAPI.post(
                `monitorSla/${projectId}`,
                data
            );

            dispatch(createMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(createMonitorSlaFailure(errorMsg));
        }
    };
};

export const updateMonitorSlaRequest: Function = (): void => {
    return {
        type: types.UPDATE_MONITOR_SLA_REQUEST,
    };
};

export const updateMonitorSlaSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.UPDATE_MONITOR_SLA_SUCCESS,
        payload,
    };
};

export const updateMonitorSlaFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UPDATE_MONITOR_SLA_FAILURE,
        payload: error,
    };
};

export const updateMonitorSla: $TSFixMe = (
    projectId: ObjectID,
    monitorSlaId: $TSFixMe,
    data: $TSFixMe,
    handleDefault: $TSFixMe = false
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(updateMonitorSlaRequest());

            data.handleDefault = handleDefault;
            const response: $TSFixMe = await BackendAPI.put(
                `monitorSla/${projectId}/${monitorSlaId}`,
                data
            );

            dispatch(updateMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(updateMonitorSlaFailure(errorMsg));
        }
    };
};

export const fetchMonitorSlasRequest: Function = (): void => {
    return {
        type: types.FETCH_MONITOR_SLAS_REQUEST,
    };
};

export const fetchMonitorSlasSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.FETCH_MONITOR_SLAS_SUCCESS,
        payload,
    };
};

export const fetchMonitorSlasFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_MONITOR_SLAS_FAILURE,
        payload: error,
    };
};

export const fetchMonitorSlas: $TSFixMe = (
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchMonitorSlasRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `monitorSla/${projectId}?skip=${skip}&limit=${limit}`
            );

            dispatch(fetchMonitorSlasSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchMonitorSlasFailure(errorMsg));
        }
    };
};

export const deleteMonitorSlaRequest: Function = (): void => {
    return {
        type: types.DELETE_MONITOR_SLA_REQUEST,
    };
};

export const deleteMonitorSlaSuccess: Function = (payload: $TSFixMe): void => {
    return {
        type: types.DELETE_MONITOR_SLA_SUCCESS,
        payload,
    };
};

export const deleteMonitorSlaFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_MONITOR_SLA_FAILURE,
        payload: error,
    };
};

export const deleteMonitorSla: $TSFixMe = (
    projectId: ObjectID,
    monitorSlaId: $TSFixMe
) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(deleteMonitorSlaRequest());

            const response: $TSFixMe =
                await delete `monitorSla/${projectId}/${monitorSlaId}`;

            dispatch(deleteMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(deleteMonitorSlaFailure(errorMsg));
        }
    };
};

// Set active monitor sla
export const setActiveMonitorSla: Function = (monitorSlaId: $TSFixMe): void => {
    return {
        type: types.SET_ACTIVE_MONITOR_SLA,
        payload: monitorSlaId,
    };
};

export const fetchDefaultMonitorSlaRequest: Function = (): void => {
    return {
        type: types.FETCH_DEFAULT_MONITOR_SLA_REQUEST,
    };
};

export const fetchDefaultMonitorSlaSuccess: Function = (
    payload: $TSFixMe
): void => {
    return {
        type: types.FETCH_DEFAULT_MONITOR_SLA_SUCCESS,
        payload,
    };
};

export const fetchDefaultMonitorSlaFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_DEFAULT_MONITOR_SLA_FAILURE,
        payload: error,
    };
};

export const fetchDefaultMonitorSla: $TSFixMe = (projectId: ObjectID) => {
    return async (dispatch: Dispatch) => {
        try {
            dispatch(fetchDefaultMonitorSlaRequest());

            const response: $TSFixMe = await BackendAPI.get(
                `monitorSla/${projectId}/defaultMonitorSla`
            );

            dispatch(fetchDefaultMonitorSlaSuccess(response.data));
        } catch (error) {
            const errorMsg: $TSFixMe =
                error.response && error.response.data
                    ? error.response.data
                    : error.data
                    ? error.data
                    : error.message
                    ? error.message
                    : 'Network Error';
            dispatch(fetchDefaultMonitorSlaFailure(errorMsg));
        }
    };
};
export const paginateNext: Function = (): void => {
    return {
        type: types.NEXT_MONITOR_SLA_PAGE,
    };
};
export const paginatePrev: Function = (): void => {
    return {
        type: types.PREV_MONITOR_SLA_PAGE,
    };
};