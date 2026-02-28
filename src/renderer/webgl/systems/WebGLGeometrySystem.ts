import type { DrawCall } from "picogl";
import type { App as PicoApp, Texture, UniformBuffer } from "picogl";

import type { CacheSession } from "../../../rs/loaders/CacheSession";
import type { SdMapData } from "../../loader/SdMapData";
import type { WebGLPrograms } from "../core/WebGLPrograms";
import type { LocMapWorkItem, NpcMapWorkItem } from "../../MapRenderWorkBuilder";
import type { WebGLMapSquare } from "../renderables/WebGLMapSquare";
import { WebGLMapSquare as WebGLMapSquareImpl } from "../renderables/WebGLMapSquare";
import type { DrawCallKey } from "../renderables/WebGLRenderable";
import type { WebGLRenderable } from "../renderables/WebGLRenderable";

import {
    ensureDrawRangePatchBackendInit,
    isDrawRangePatchBackendReady,
    resetDrawRangePatchBackend,
} from "../../../wasm/DrawRangePatchBackend";
import { applyDrawRangePatches } from "../core/applyDrawRangePatches";

type MapDrawPassExecutor = Readonly<{
    draw(drawCall: DrawCall, drawRangesPacked: Int32Array): void;
    applyLocAnimationPatchesForPass(
        renderable: WebGLMapSquare,
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
        drawCall: DrawCall,
        drawRangesPacked: Int32Array,
    ): void;
    applyNpcAnimationPatchesForPass(
        renderable: WebGLMapSquare,
        isAlpha: boolean,
        drawCall: DrawCall,
        drawRangesPacked: Int32Array,
    ): void;
}>;

class MapDrawPasses {
    renderLoc(
        executor: MapDrawPassExecutor,
        items: ReadonlyArray<LocMapWorkItem<WebGLMapSquare>>,
    ): void {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const drawCallKey = item.map.getDrawCallKey(item.isAlpha, item.isInteract, item.isLod);
            const { drawCall, drawRangesPacked } = item.map.getDrawCallByKey(drawCallKey);
            executor.applyLocAnimationPatchesForPass(
                item.map,
                item.isAlpha,
                item.isInteract,
                item.isLod,
                drawCall,
                drawRangesPacked,
            );
            executor.draw(drawCall, drawRangesPacked);
        }
    }

    renderNpc(
        executor: MapDrawPassExecutor,
        items: ReadonlyArray<NpcMapWorkItem<WebGLMapSquare>>,
        npcDataTextureIndex: number,
        npcDataTexture: Texture | undefined,
    ): void {
        if (!npcDataTexture) {
            return;
        }

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const dataOffset = item.map.npcDataTextureOffsets[npcDataTextureIndex] | 0;
            if (dataOffset === -1) {
                continue;
            }
            const { drawCall, drawRangesPacked } = item.map.drawCallNpc;
            drawCall.uniform("u_npcDataOffset", dataOffset);
            drawCall.texture("u_npcDataTexture", npcDataTexture);
            executor.applyNpcAnimationPatchesForPass(item.map, item.isAlpha, drawCall, drawRangesPacked);
            executor.draw(drawCall, drawRangesPacked);
        }
    }
}

export class WebGLGeometrySystem {
    readonly mapDrawPasses = new MapDrawPasses();

    ensureTickBackendInit(): void {
        ensureDrawRangePatchBackendInit();
    }

    isTickBackendReady(): boolean {
        return isDrawRangePatchBackendReady();
    }

    dispose(): void {
        resetDrawRangePatchBackend();
    }

    loadMapSquare(
        session: CacheSession,
        app: PicoApp,
        programs: WebGLPrograms,
        textureArray: Texture,
        textureMaterials: Texture,
        textureSlotLut: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        timeSec: number,
        frameCount: number,
    ): WebGLMapSquare {
        return WebGLMapSquareImpl.load(
            session.getSeqTypeLoader(),
            session.getSeqFrameLoader(),
            session.getNpcTypeLoader(),
            session.getBasTypeLoader(),
            app,
            programs.mainProgram!,
            programs.mainAlphaProgram!,
            programs.npcProgram!,
            textureArray,
            textureMaterials,
            textureSlotLut,
            sceneUniformBuffer,
            mapData,
            timeSec,
            frameCount,
        );
    }

    applyLocAnimationPatchesForPass(
        renderable: WebGLRenderable,
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
        drawCall: DrawCall,
        drawRangesPacked: Int32Array,
    ): void {
        const stream = renderable.getLocTickPatchStream(isAlpha, isInteract, isLod);
        if (!stream) {
            return;
        }
        applyDrawRangePatches(drawCall, drawRangesPacked, stream.patches, stream.count);
    }

    applyNpcAnimationPatchesForPass(
        renderable: WebGLRenderable,
        isAlpha: boolean,
        drawCall: DrawCall,
        drawRangesPacked: Int32Array,
    ): void {
        const stream = renderable.getNpcTickPatchStream(isAlpha);
        if (!stream) {
            return;
        }
        applyDrawRangePatches(drawCall, drawRangesPacked, stream.patches, stream.count);
    }
}
