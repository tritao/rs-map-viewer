import { mat4, vec4, type mat4 as Mat4, type vec3 as Vec3 } from "gl-matrix";

const walkInverseViewProj = mat4.create();
const walkNearClip = vec4.create();
const walkFarClip = vec4.create();
const walkNearWorld = vec4.create();
const walkFarWorld = vec4.create();

export type WalkDestination = Readonly<{ x: number; z: number }>;

export function resolveWalkDestination(input: Readonly<{
    screenX: number;
    screenY: number;
    viewportWidth: number;
    viewportHeight: number;
    viewProjMatrix: Mat4;
}>): WalkDestination | undefined {
    const width = input.viewportWidth | 0;
    const height = input.viewportHeight | 0;
    if ((width | 0) <= 0 || (height | 0) <= 0) {
        return undefined;
    }

    const inverseViewProj = mat4.invert(walkInverseViewProj, input.viewProjMatrix);
    if (!inverseViewProj) {
        return undefined;
    }

    const clipX = ((input.screenX / width) * 2) - 1;
    const clipY = 1 - ((input.screenY / height) * 2);
    walkNearClip[0] = clipX;
    walkNearClip[1] = clipY;
    walkNearClip[2] = -1;
    walkNearClip[3] = 1;
    walkFarClip[0] = clipX;
    walkFarClip[1] = clipY;
    walkFarClip[2] = 1;
    walkFarClip[3] = 1;

    vec4.transformMat4(walkNearWorld, walkNearClip, inverseViewProj);
    vec4.transformMat4(walkFarWorld, walkFarClip, inverseViewProj);

    const nearW = walkNearWorld[3];
    const farW = walkFarWorld[3];
    if (Math.abs(nearW) <= 1e-6 || Math.abs(farW) <= 1e-6) {
        return undefined;
    }

    const originX = walkNearWorld[0] / nearW;
    const originY = walkNearWorld[1] / nearW;
    const originZ = walkNearWorld[2] / nearW;
    const farX = walkFarWorld[0] / farW;
    const farY = walkFarWorld[1] / farW;
    const farZ = walkFarWorld[2] / farW;
    const directionY = farY - originY;
    if (Math.abs(directionY) <= 1e-6) {
        return undefined;
    }

    const t = -originY / directionY;
    if (!Number.isFinite(t) || t < 0) {
        return undefined;
    }

    return {
        x: originX + (farX - originX) * t,
        z: originZ + (farZ - originZ) * t,
    };
}

export function advanceWalkNavigation(input: Readonly<{
    destination: WalkDestination;
    cameraPosition: Vec3;
    cameraSpeed: number;
    deltaTime: number;
}>): boolean {
    const currentX = input.cameraPosition[0];
    const currentZ = input.cameraPosition[2];
    const deltaX = input.destination.x - currentX;
    const deltaZ = input.destination.z - currentZ;
    const distance = Math.hypot(deltaX, deltaZ);
    if (!Number.isFinite(distance) || distance <= 1) {
        input.cameraPosition[0] = input.destination.x;
        input.cameraPosition[2] = input.destination.z;
        return true;
    }

    const deltaTimeSec = input.deltaTime / 1000;
    const speed = Math.max(16, 64 * input.cameraSpeed) * deltaTimeSec;
    const step = Math.min(distance, speed);
    input.cameraPosition[0] = currentX + (deltaX / distance) * step;
    input.cameraPosition[2] = currentZ + (deltaZ / distance) * step;
    return false;
}
