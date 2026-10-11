import type { CameraPermission, Meeting, Notification, User } from "./mockData";

export async function fetchUser(): Promise<User | null> {
    // TODO: API 연결
    return null;
}

export async function fetchActiveMeetings(): Promise<Meeting[]> {
    // TODO: API 연결
    return [];
}

export async function fetchNotifications(): Promise<Notification[]> {
    // TODO: API 연결
    return [];
}

export async function requestCameraPermission(): Promise<CameraPermission> {
    // TODO: 네이티브 카메라 권한 API 연결
    return "granted";
}

export async function joinRoom(_code: string): Promise<void> {
    // TODO: API 연결
}

export async function createRoom(): Promise<void> {
    // TODO: API 연결
}
