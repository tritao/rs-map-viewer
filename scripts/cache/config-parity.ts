import { spawnSync } from "child_process";

import { loadCacheFiles, loadCacheInfos } from "./load-util";

import { CacheInfo, getGameTypeName, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { Dat2ConfigArchiveId, OsrsConfigArchiveId, Rs2ConfigArchiveId } from "../../src/rs/cache/ConfigArchiveId";
import { detectCacheType, CacheType } from "../../src/rs/cache/CacheType";
import { Dat2IndexId, Rs2IndexId } from "../../src/rs/cache/IndexId";
import { createCacheSystemFromFiles } from "../../src/rs/cache/platform/CacheStoreFromFiles";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { decodeTypeFromBytes } from "../../src/rs/config/decode/decodeType";
import { BasType } from "../../src/rs/config/bastype/BasType";
import { EnumType } from "../../src/rs/config/enumtype/EnumType";
import { OverlayFloorType } from "../../src/rs/config/floortype/OverlayFloorType";
import { UnderlayFloorType } from "../../src/rs/config/floortype/UnderlayFloorType";
import { IdkType } from "../../src/rs/config/idktype/IdkType";
import { InvType } from "../../src/rs/config/invtype/InvType";
import { LocType } from "../../src/rs/config/loctype/LocType";
import { MapSceneType } from "../../src/rs/config/mapscenetype/MapSceneType";
import { MapElementType } from "../../src/rs/config/meltype/MapElementType";
import { NpcType } from "../../src/rs/config/npctype/NpcType";
import { ObjType } from "../../src/rs/config/objtype/ObjType";
import { ParamType } from "../../src/rs/config/paramtype/ParamType";
import { QuestType } from "../../src/rs/config/questtype/QuestType";
import { SeqSoundEffect, SeqType } from "../../src/rs/config/seqtype/SeqType";
import { SpotAnimType } from "../../src/rs/config/spotanimtype/SpotAnimType";
import { StructType } from "../../src/rs/config/structtype/StructType";
import { VarBitType } from "../../src/rs/config/vartype/bit/VarBitType";
import { VarClientIntType } from "../../src/rs/config/vartype/client/VarClientIntType";
import { VarClientStrType } from "../../src/rs/config/vartype/client/VarClientStrType";
import { VarPlayerType } from "../../src/rs/config/vartype/player/VarPlayerType";
import { CacheRules, computeCacheRules } from "../../src/rs/loaders/CacheRules";
import { GraphicsDefaults } from "../../src/rs/config/defaults/GraphicsDefaults";
import { ParamsMap } from "../../src/rs/config/Type";

type Args = { cacheName?: string; limit: number; kinds?: string[] };

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 50 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--cache") args.cacheName = argv[++i];
        else if (a === "--limit") args.limit = Number(argv[++i]);
        else if (a === "--kinds") args.kinds = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error("Invalid --limit");
    return args;
}

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");
    if (!cacheName) return latest;
    return caches.find((c) => c.name === cacheName) ?? latest;
}

function fnv1a32UpdateInt(h: number, v: number): number {
    const x = v >>> 0;
    h ^= x & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 16) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (x >>> 24) & 0xff;
    h = Math.imul(h, 16777619);
    return h >>> 0;
}

function fnv1a32UpdateByte(h: number, v: number): number {
    h ^= v & 0xff;
    h = Math.imul(h, 16777619);
    return h >>> 0;
}

function fnv1a32UpdateStringBytes(h: number, s: string | undefined | null): number {
    const str = s ?? "";
    h = fnv1a32UpdateInt(h, str.length);
    for (let i = 0; i < str.length; i++) {
        h = fnv1a32UpdateByte(h, str.charCodeAt(i) & 0xff);
    }
    return h >>> 0;
}

function fnv1a32UpdateIntArray(h: number, a: readonly number[] | undefined): number {
    const arr = a ?? [];
    h = fnv1a32UpdateInt(h, arr.length);
    for (const v of arr) h = fnv1a32UpdateInt(h, v | 0);
    return h >>> 0;
}

function fnv1a32UpdateParams(h: number, params: ParamsMap | undefined): number {
    if (!params) {
        return fnv1a32UpdateInt(h, 0);
    }
    h = fnv1a32UpdateInt(h, params.size);
    for (const [k, v] of params.entries()) {
        h = fnv1a32UpdateInt(h, k | 0);
        if (typeof v === "string") {
            h = fnv1a32UpdateInt(h, 1);
            h = fnv1a32UpdateStringBytes(h, v);
        } else {
            h = fnv1a32UpdateInt(h, 0);
            h = fnv1a32UpdateInt(h, v | 0);
        }
    }
    return h >>> 0;
}

const PARAM_SCRIPT_VAR_TYPES: string[] = [
    "€",
    "\u0000",
    "‚",
    "ƒ",
    "„",
    "…",
    "†",
    "‡",
    "ˆ",
    "‰",
    "Š",
    "‹",
    "Œ",
    "\u0000",
    "Ž",
    "\u0000",
    "\u0000",
    "‘",
    "’",
    "“",
    "”",
    "•",
    "–",
    "—",
    "˜",
    "™",
    "š",
    "›",
    "œ",
    "\u0000",
    "ž",
    "Ÿ",
];

const PARAM_REVERSE: Map<string, number> = (() => {
    const m = new Map<string, number>();
    for (let i = 0; i < PARAM_SCRIPT_VAR_TYPES.length; i++) {
        let s = PARAM_SCRIPT_VAR_TYPES[i];
        if (s === "\u0000") s = "?";
        m.set(s, 128 + i);
    }
    return m;
})();

function paramTypeToRawByte(type: string | undefined): number {
    if (!type) return 0;
    const c0 = type.charCodeAt(0);
    if (c0 === 0) return 0;
    if (c0 < 128) return c0;
    if (c0 >= 160 && c0 < 256) return c0;
    const mapped = PARAM_REVERSE.get(type);
    if (mapped !== undefined) return mapped;
    // Fallback: best-effort, but should not happen for real ParamTypes.
    return c0 & 0xff;
}

type Kind =
    | "underlay"
    | "overlay"
    | "varbit"
    | "idk"
    | "inv"
    | "enum"
    | "param"
    | "loc"
    | "npc"
    | "obj"
    | "seq"
    | "spotanim"
    | "bas"
    | "quest"
    | "mapscene"
    | "mapelement"
    | "struct"
    | "varplayer"
    | "varclient_int"
    | "varclient_str"
    | "graphics_defaults";

const DEFAULT_KINDS: Kind[] = [
    "underlay",
    "overlay",
    "idk",
    "inv",
    "varbit",
    "enum",
    "param",
    "loc",
    "npc",
    "obj",
    "seq",
    "spotanim",
    "bas",
    "quest",
    "mapscene",
    "mapelement",
    "struct",
    "varplayer",
    "varclient_int",
    "varclient_str",
    "graphics_defaults",
];

function hashUnderlay(t: UnderlayFloorType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x554e444c); // 'UNDL'
    h = fnv1a32UpdateInt(h, t.rgbColor | 0);
    h = fnv1a32UpdateInt(h, t.hue | 0);
    h = fnv1a32UpdateInt(h, t.saturation | 0);
    h = fnv1a32UpdateInt(h, t.lightness | 0);
    h = fnv1a32UpdateInt(h, t.hueMultiplier | 0);
    h = fnv1a32UpdateInt(h, t.isOverlay ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.textureId | 0);
    h = fnv1a32UpdateInt(h, t.textureSize | 0);
    h = fnv1a32UpdateInt(h, t.blockShadow ? 1 : 0);
    return h | 0;
}

function hashOverlay(t: OverlayFloorType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4f564552); // 'OVER'
    h = fnv1a32UpdateInt(h, t.primaryRgb | 0);
    h = fnv1a32UpdateInt(h, t.textureId | 0);
    h = fnv1a32UpdateInt(h, t.secondaryTextureId | 0);
    h = fnv1a32UpdateInt(h, t.hideUnderlay ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.secondaryRgb | 0);
    h = fnv1a32UpdateInt(h, t.blendRgb | 0);
    h = fnv1a32UpdateInt(h, t.primaryHsl | 0);
    h = fnv1a32UpdateInt(h, t.blendHsl | 0);
    h = fnv1a32UpdateInt(h, t.occludes ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.hue | 0);
    h = fnv1a32UpdateInt(h, t.saturation | 0);
    h = fnv1a32UpdateInt(h, t.lightness | 0);
    h = fnv1a32UpdateInt(h, t.hueBlend | 0);
    h = fnv1a32UpdateInt(h, t.hueMultiplier | 0);
    h = fnv1a32UpdateInt(h, t.secondaryHue | 0);
    h = fnv1a32UpdateInt(h, t.secondarySaturation | 0);
    h = fnv1a32UpdateInt(h, t.secondaryLightness | 0);
    h = fnv1a32UpdateInt(h, t.textureSize | 0);
    h = fnv1a32UpdateInt(h, t.blockShadow ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.textureBrightness | 0);
    h = fnv1a32UpdateInt(h, t.blendPriority | 0);
    h = fnv1a32UpdateInt(h, t.blendable ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.underwaterColor | 0);
    h = fnv1a32UpdateInt(h, t.waterOpacity | 0);
    h = fnv1a32UpdateInt(h, t.waterBias | 0);
    h = fnv1a32UpdateInt(h, t.isOverlay ? 1 : 0);
    h = fnv1a32UpdateStringBytes(h, t.name ?? "");
    return h | 0;
}

function hashVarBit(t: VarBitType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x56425254); // 'VBRT'
    h = fnv1a32UpdateInt(h, t.baseVar | 0);
    h = fnv1a32UpdateInt(h, t.startBit | 0);
    h = fnv1a32UpdateInt(h, t.endBit | 0);
    return h | 0;
}

function hashEnum(t: EnumType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x454e554d); // 'ENUM'
    h = fnv1a32UpdateInt(h, (t.inputType?.charCodeAt(0) ?? 0) | 0);
    h = fnv1a32UpdateInt(h, (t.outputType?.charCodeAt(0) ?? 0) | 0);
    h = fnv1a32UpdateStringBytes(h, t.defaultString);
    h = fnv1a32UpdateInt(h, (t.defaultInt ?? 0) | 0);
    h = fnv1a32UpdateInt(h, (t.outputCount ?? 0) | 0);
    h = fnv1a32UpdateIntArray(h, t.keys);
    h = fnv1a32UpdateIntArray(h, t.intValues);
    h = fnv1a32UpdateInt(h, t.stringValues ? t.stringValues.length : 0);
    if (t.stringValues) {
        for (const s of t.stringValues) h = fnv1a32UpdateStringBytes(h, s);
    }
    return h | 0;
}

function hashParam(t: ParamType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x5041524d); // 'PARM'
    h = fnv1a32UpdateInt(h, paramTypeToRawByte(t.type) | 0);
    h = fnv1a32UpdateInt(h, t.defaultInt | 0);
    h = fnv1a32UpdateStringBytes(h, (t as any).defaultString ?? "");
    h = fnv1a32UpdateInt(h, t.autoDisable ? 1 : 0);
    return h | 0;
}

function hashLoc(t: LocType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4c4f4354); // 'LOCT'
    h = fnv1a32UpdateInt(h, t.lowDetail ? 1 : 0);
    h = fnv1a32UpdateStringBytes(h, t.name);
    h = fnv1a32UpdateInt(h, t.desc ? 1 : 0);
    if (t.desc) h = fnv1a32UpdateStringBytes(h, t.desc);

    const models: number[][] = (t as any).models ?? [];
    h = fnv1a32UpdateInt(h, models.length);
    for (const g of models) {
        h = fnv1a32UpdateInt(h, g.length);
        for (const mid of g) h = fnv1a32UpdateInt(h, mid | 0);
    }
    const types: number[] | undefined = (t as any).types;
    h = fnv1a32UpdateInt(h, types ? 1 : 0);
    if (types) {
        h = fnv1a32UpdateInt(h, types.length);
        for (const ty of types) h = fnv1a32UpdateInt(h, ty | 0);
    }

    const recolorFrom: number[] = (t as any).recolorFrom ?? [];
    const recolorTo: number[] = (t as any).recolorTo ?? [];
    h = fnv1a32UpdateInt(h, recolorFrom.length);
    for (let i = 0; i < recolorFrom.length; i++) {
        h = fnv1a32UpdateInt(h, recolorFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (recolorTo[i] ?? 0) | 0);
    }
    const retextureFrom: number[] = (t as any).retextureFrom ?? [];
    const retextureTo: number[] = (t as any).retextureTo ?? [];
    h = fnv1a32UpdateInt(h, retextureFrom.length);
    for (let i = 0; i < retextureFrom.length; i++) {
        h = fnv1a32UpdateInt(h, retextureFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (retextureTo[i] ?? 0) | 0);
    }

    h = fnv1a32UpdateInt(h, t.sizeX | 0);
    h = fnv1a32UpdateInt(h, t.sizeY | 0);
    h = fnv1a32UpdateInt(h, t.clipType | 0);
    h = fnv1a32UpdateInt(h, t.blocksProjectile ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isInteractive | 0);
    h = fnv1a32UpdateInt(h, t.contouredGround | 0);
    h = fnv1a32UpdateInt(h, t.contourGroundType | 0);
    h = fnv1a32UpdateInt(h, t.contourGroundParam | 0);
    h = fnv1a32UpdateInt(h, t.mergeNormals ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.modelClipped ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.seqId | 0);
    h = fnv1a32UpdateInt(h, t.decorDisplacement | 0);
    h = fnv1a32UpdateInt(h, t.ambient | 0);
    h = fnv1a32UpdateInt(h, t.contrast | 0);

    for (let i = 0; i < 5; i++) {
        const a = t.actions[i];
        h = fnv1a32UpdateInt(h, a ? 1 : 0);
        if (a) h = fnv1a32UpdateStringBytes(h, a);
    }

    h = fnv1a32UpdateInt(h, t.mapFunctionId | 0);
    h = fnv1a32UpdateInt(h, t.mapSceneId | 0);
    h = fnv1a32UpdateInt(h, t.flipMapSceneSprite ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.hardShadow ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.membersOnly ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.rotateMapSceneSprite ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.mapSceneRotationOffset | 0);
    h = fnv1a32UpdateInt(h, t.animated ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.cursor1Op | 0);
    h = fnv1a32UpdateInt(h, t.cursor1 | 0);
    h = fnv1a32UpdateInt(h, t.cursor2Op | 0);
    h = fnv1a32UpdateInt(h, t.cursor2 | 0);
    h = fnv1a32UpdateInt(h, t.occludeRoofs ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.forceDynamic ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isRotated ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.clipped ? 1 : 0);

    h = fnv1a32UpdateInt(h, t.modelSizeX | 0);
    h = fnv1a32UpdateInt(h, t.modelSizeHeight | 0);
    h = fnv1a32UpdateInt(h, t.modelSizeY | 0);
    h = fnv1a32UpdateInt(h, t.offsetX | 0);
    h = fnv1a32UpdateInt(h, t.offsetHeight | 0);
    h = fnv1a32UpdateInt(h, t.offsetY | 0);

    h = fnv1a32UpdateInt(h, t.obstructsGround ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isHollow ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.supportItems | 0);

    const transforms: number[] | undefined = (t as any).transforms;
    h = fnv1a32UpdateInt(h, transforms ? transforms.length : 0);
    if (transforms) {
        for (const tr of transforms) h = fnv1a32UpdateInt(h, tr | 0);
    }
    h = fnv1a32UpdateInt(h, t.transformVarbit | 0);
    h = fnv1a32UpdateInt(h, t.transformVarp | 0);

    h = fnv1a32UpdateInt(h, t.ambientSoundId | 0);
    h = fnv1a32UpdateParams(h, (t as any).params);
    return h | 0;
}

function hashNpc(t: NpcType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4e504354); // 'NPCT'
    h = fnv1a32UpdateStringBytes(h, t.name);
    h = fnv1a32UpdateInt(h, t.size | 0);
    h = fnv1a32UpdateIntArray(h, (t as any).modelIds);
    h = fnv1a32UpdateIntArray(h, (t as any).chatheadModelIds);
    h = fnv1a32UpdateInt(h, t.idleSeqId | 0);
    h = fnv1a32UpdateInt(h, t.turnLeftSeqId | 0);
    h = fnv1a32UpdateInt(h, t.turnRightSeqId | 0);
    h = fnv1a32UpdateInt(h, t.walkSeqId | 0);
    h = fnv1a32UpdateInt(h, t.walkBackSeqId | 0);
    h = fnv1a32UpdateInt(h, t.walkLeftSeqId | 0);
    h = fnv1a32UpdateInt(h, t.walkRightSeqId | 0);

    const recolorFrom: number[] = (t as any).recolorFrom ?? [];
    const recolorTo: number[] = (t as any).recolorTo ?? [];
    h = fnv1a32UpdateInt(h, recolorFrom.length);
    for (let i = 0; i < recolorFrom.length; i++) {
        h = fnv1a32UpdateInt(h, recolorFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (recolorTo[i] ?? 0) | 0);
    }
    const retextureFrom: number[] = (t as any).retextureFrom ?? [];
    const retextureTo: number[] = (t as any).retextureTo ?? [];
    h = fnv1a32UpdateInt(h, retextureFrom.length);
    for (let i = 0; i < retextureFrom.length; i++) {
        h = fnv1a32UpdateInt(h, retextureFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (retextureTo[i] ?? 0) | 0);
    }

    for (let i = 0; i < 5; i++) {
        const a = t.actions[i];
        h = fnv1a32UpdateInt(h, a ? 1 : 0);
        if (a) h = fnv1a32UpdateStringBytes(h, a);
    }

    h = fnv1a32UpdateInt(h, t.drawMapDot ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.combatLevel | 0);
    h = fnv1a32UpdateInt(h, t.widthScale | 0);
    h = fnv1a32UpdateInt(h, t.heightScale | 0);
    h = fnv1a32UpdateInt(h, t.isVisible ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.ambient | 0);
    h = fnv1a32UpdateInt(h, t.contrast | 0);
    h = fnv1a32UpdateInt(h, t.headIconPrayer | 0);
    h = fnv1a32UpdateIntArray(h, (t as any).headIconSpriteIds);
    h = fnv1a32UpdateIntArray(h, (t as any).headIconSpriteIndices);
    h = fnv1a32UpdateInt(h, t.rotationSpeed | 0);
    h = fnv1a32UpdateIntArray(h, (t as any).transforms);
    h = fnv1a32UpdateInt(h, t.transformVarbit | 0);
    h = fnv1a32UpdateInt(h, t.transformVarp | 0);
    h = fnv1a32UpdateInt(h, t.isInteractable ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isClickable ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isFollower ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.runSeqId | 0);
    h = fnv1a32UpdateInt(h, t.runBackSeqId | 0);
    h = fnv1a32UpdateInt(h, t.runLeftSeqId | 0);
    h = fnv1a32UpdateInt(h, t.runRightSeqId | 0);
    h = fnv1a32UpdateInt(h, t.crawlSeqId | 0);
    h = fnv1a32UpdateInt(h, t.crawlBackSeqId | 0);
    h = fnv1a32UpdateInt(h, t.crawlLeftSeqId | 0);
    h = fnv1a32UpdateInt(h, t.crawlRightSeqId | 0);
    h = fnv1a32UpdateInt(h, t.category | 0);
    h = fnv1a32UpdateInt(h, t.loginScreenProps | 0);
    h = fnv1a32UpdateInt(h, t.spawnDirection | 0);
    h = fnv1a32UpdateInt(h, t.basTypeId | 0);
    h = fnv1a32UpdateInt(h, t.readySoundId | 0);
    h = fnv1a32UpdateInt(h, t.crawlSoundId | 0);
    h = fnv1a32UpdateInt(h, t.walkSoundId | 0);
    h = fnv1a32UpdateInt(h, t.runSoundId | 0);
    h = fnv1a32UpdateInt(h, t.soundRangeMin | 0);
    h = fnv1a32UpdateInt(h, t.soundRangeMax | 0);
    h = fnv1a32UpdateInt(h, t.soundVolume | 0);
    h = fnv1a32UpdateInt(h, t.cursor1Op | 0);
    h = fnv1a32UpdateInt(h, t.cursor1 | 0);
    h = fnv1a32UpdateInt(h, t.cursor2Op | 0);
    h = fnv1a32UpdateInt(h, t.cursor2 | 0);
    h = fnv1a32UpdateInt(h, t.attackCursor | 0);
    h = fnv1a32UpdateInt(h, t.mapElementId | 0);
    h = fnv1a32UpdateInt(h, t.mobilisingArmiesIcon | 0);
    h = fnv1a32UpdateInt(h, t.timerbarSpriteId | 0);
    h = fnv1a32UpdateInt(h, t.healthBarSpriteId | 0);
    h = fnv1a32UpdateInt(h, t.lowPriority ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.colourHue | 0);
    h = fnv1a32UpdateInt(h, t.colourSaturation | 0);
    h = fnv1a32UpdateInt(h, t.colourLightness | 0);
    h = fnv1a32UpdateInt(h, t.colourScale | 0);
    h = fnv1a32UpdateInt(h, t.followerOpsPriorityFlag | 0);
    h = fnv1a32UpdateIntArray(h, (t as any).quests);
    h = fnv1a32UpdateInt(h, t.vorbisSound ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.soundRateMin | 0);
    h = fnv1a32UpdateInt(h, t.soundRateMax | 0);
    h = fnv1a32UpdateInt(h, t.pickSizeShift | 0);
    h = fnv1a32UpdateParams(h, (t as any).params);
    return h | 0;
}

function hashObj(t: ObjType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4f424a54); // 'OBJT'
    h = fnv1a32UpdateInt(h, (t.model ?? -1) | 0);
    h = fnv1a32UpdateStringBytes(h, t.name);
    const recolorFrom: number[] = (t as any).recolorFrom ?? [];
    const recolorTo: number[] = (t as any).recolorTo ?? [];
    h = fnv1a32UpdateInt(h, recolorFrom.length);
    for (let i = 0; i < recolorFrom.length; i++) {
        h = fnv1a32UpdateInt(h, recolorFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (recolorTo[i] ?? 0) | 0);
    }
    const retextureFrom: number[] = (t as any).retextureFrom ?? [];
    const retextureTo: number[] = (t as any).retextureTo ?? [];
    h = fnv1a32UpdateInt(h, retextureFrom.length);
    for (let i = 0; i < retextureFrom.length; i++) {
        h = fnv1a32UpdateInt(h, retextureFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (retextureTo[i] ?? 0) | 0);
    }
    h = fnv1a32UpdateInt(h, t.zoom2d | 0);
    h = fnv1a32UpdateInt(h, t.xan2d | 0);
    h = fnv1a32UpdateInt(h, t.yan2d | 0);
    h = fnv1a32UpdateInt(h, t.zan2d | 0);
    h = fnv1a32UpdateInt(h, t.offsetX2d | 0);
    h = fnv1a32UpdateInt(h, t.offsetY2d | 0);
    h = fnv1a32UpdateStringBytes(h, (t as any).op9 ?? "");
    h = fnv1a32UpdateInt(h, t.stackability | 0);
    h = fnv1a32UpdateInt(h, t.price | 0);
    h = fnv1a32UpdateInt(h, t.op13 | 0);
    h = fnv1a32UpdateInt(h, t.op14 | 0);
    h = fnv1a32UpdateInt(h, t.isMembers ? 1 : 0);

    for (const a of t.groundActions) {
        h = fnv1a32UpdateInt(h, a ? 1 : 0);
        if (a) h = fnv1a32UpdateStringBytes(h, a);
    }
    for (const a of t.inventoryActions) {
        h = fnv1a32UpdateInt(h, a ? 1 : 0);
        if (a) h = fnv1a32UpdateStringBytes(h, a);
    }

    h = fnv1a32UpdateInt(h, t.shiftClickIndex | 0);
    h = fnv1a32UpdateInt(h, t.maleModel | 0);
    h = fnv1a32UpdateInt(h, t.maleModel1 | 0);
    h = fnv1a32UpdateInt(h, t.maleOffset | 0);
    h = fnv1a32UpdateInt(h, t.femaleModel | 0);
    h = fnv1a32UpdateInt(h, t.femaleModel1 | 0);
    h = fnv1a32UpdateInt(h, t.femaleOffset | 0);
    h = fnv1a32UpdateInt(h, t.maleModel2 | 0);
    h = fnv1a32UpdateInt(h, t.femaleModel2 | 0);
    h = fnv1a32UpdateInt(h, t.maleHeadModel | 0);
    h = fnv1a32UpdateInt(h, t.maleHeadModel2 | 0);
    h = fnv1a32UpdateInt(h, t.femaleHeadModel | 0);
    h = fnv1a32UpdateInt(h, t.femaleHeadModel2 | 0);
    const countObj: number[] = (t as any).countObj ?? [];
    const countCo: number[] = (t as any).countCo ?? [];
    h = fnv1a32UpdateInt(h, countObj.length);
    for (let i = 0; i < countObj.length; i++) {
        h = fnv1a32UpdateInt(h, countObj[i] | 0);
        h = fnv1a32UpdateInt(h, (countCo[i] ?? 0) | 0);
    }
    h = fnv1a32UpdateInt(h, t.op27 | 0);
    h = fnv1a32UpdateInt(h, t.note | 0);
    h = fnv1a32UpdateInt(h, t.noteTemplate | 0);
    h = fnv1a32UpdateInt(h, t.resizeX | 0);
    h = fnv1a32UpdateInt(h, t.resizeY | 0);
    h = fnv1a32UpdateInt(h, t.resizeZ | 0);
    h = fnv1a32UpdateInt(h, t.ambient | 0);
    h = fnv1a32UpdateInt(h, t.contrast | 0);
    h = fnv1a32UpdateInt(h, t.team | 0);
    h = fnv1a32UpdateInt(h, t.isTradable ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.op75 | 0);
    h = fnv1a32UpdateInt(h, t.unnotedId | 0);
    h = fnv1a32UpdateInt(h, t.notedId | 0);
    h = fnv1a32UpdateInt(h, t.placeholder | 0);
    h = fnv1a32UpdateInt(h, t.placeholderTemplate | 0);
    h = fnv1a32UpdateParams(h, t.params);
    return h | 0;
}

function hashSeq(t: SeqType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x53455154); // 'SEQT'
    const frameIds: number[] = (t as any).frameIds ?? [];
    const frameLengths: number[] = (t as any).frameLengths ?? [];
    h = fnv1a32UpdateInt(h, frameIds.length);
    for (let i = 0; i < frameIds.length; i++) {
        h = fnv1a32UpdateInt(h, frameIds[i] | 0);
        h = fnv1a32UpdateInt(h, (frameLengths[i] ?? 0) | 0);
    }

    h = fnv1a32UpdateIntArray(h, (t as any).chatFrameIds);
    h = fnv1a32UpdateIntArray(h, (t as any).masks);
    const sounds: SeqSoundEffect[] | undefined = (t as any).frameSounds;
    h = fnv1a32UpdateInt(h, sounds ? sounds.length : 0);
    if (sounds) {
        for (const e of sounds) {
            h = fnv1a32UpdateInt(h, e.id | 0);
            h = fnv1a32UpdateInt(h, e.loops | 0);
            h = fnv1a32UpdateInt(h, e.location | 0);
            h = fnv1a32UpdateInt(h, e.retain | 0);
        }
    }

    h = fnv1a32UpdateInt(h, t.frameStep | 0);
    h = fnv1a32UpdateInt(h, t.stretches ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.forcedPriority | 0);
    h = fnv1a32UpdateInt(h, t.leftHandItem | 0);
    h = fnv1a32UpdateInt(h, t.rightHandItem | 0);
    h = fnv1a32UpdateInt(h, t.maxLoops | 0);
    h = fnv1a32UpdateInt(h, t.looping ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.precedenceAnimating | 0);
    h = fnv1a32UpdateInt(h, t.priority | 0);
    h = fnv1a32UpdateInt(h, t.replayMode | 0);
    h = fnv1a32UpdateInt(h, t.tweened ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.vorbisSound ? 1 : 0);

    const vol = t.soundVolumesByIndex ? Array.from(t.soundVolumesByIndex.entries()).sort((a, b) => a[0] - b[0]) : [];
    h = fnv1a32UpdateInt(h, vol.length);
    for (const [idx, v] of vol) {
        h = fnv1a32UpdateInt(h, idx | 0);
        h = fnv1a32UpdateInt(h, v | 0);
    }

    const rateMin = t.soundRateMinByIndex ? Array.from(t.soundRateMinByIndex.entries()) : [];
    const rateMax = t.soundRateMaxByIndex ? Array.from(t.soundRateMaxByIndex.entries()) : [];
    const rates = new Map<number, { min: number; max: number }>();
    for (const [k, v] of rateMin) rates.set(k, { min: v, max: rates.get(k)?.max ?? 0 });
    for (const [k, v] of rateMax) rates.set(k, { min: rates.get(k)?.min ?? 0, max: v });
    const rateArr = Array.from(rates.entries()).sort((a, b) => a[0] - b[0]);
    h = fnv1a32UpdateInt(h, rateArr.length);
    for (const [idx, r] of rateArr) {
        h = fnv1a32UpdateInt(h, idx | 0);
        h = fnv1a32UpdateInt(h, r.min | 0);
        h = fnv1a32UpdateInt(h, r.max | 0);
    }

    h = fnv1a32UpdateInt(h, t.animMayaId | 0);
    h = fnv1a32UpdateInt(h, t.animMayaStart | 0);
    h = fnv1a32UpdateInt(h, t.animMayaEnd | 0);
    const mayaMasks: boolean[] | undefined = (t as any).animMayaMasks;
    h = fnv1a32UpdateInt(h, mayaMasks ? 1 : 0);
    if (mayaMasks) {
        for (let i = 0; i < 256; i++) {
            h = fnv1a32UpdateInt(h, mayaMasks[i] ? 1 : 0);
        }
    }
    const mayaSoundsMap: Map<number, SeqSoundEffect> | undefined = (t as any).animMayaFrameSounds;
    const mayaSounds = mayaSoundsMap
        ? Array.from(mayaSoundsMap.entries()).sort((a, b) => a[0] - b[0])
        : [];
    h = fnv1a32UpdateInt(h, mayaSounds.length);
    for (const [frame, e] of mayaSounds) {
        h = fnv1a32UpdateInt(h, frame | 0);
        h = fnv1a32UpdateInt(h, e.id | 0);
        h = fnv1a32UpdateInt(h, e.loops | 0);
        h = fnv1a32UpdateInt(h, e.location | 0);
        h = fnv1a32UpdateInt(h, e.retain | 0);
    }

    h = fnv1a32UpdateInt(h, t.rotateNormals ? 1 : 0);
    return h | 0;
}

function hashSpotAnim(t: SpotAnimType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x5350414e); // 'SPAN'
    h = fnv1a32UpdateInt(h, ((t as any).modelId ?? -1) | 0);
    h = fnv1a32UpdateInt(h, t.sequenceId | 0);
    const recolorFrom: number[] = (t as any).recolorFrom ?? [];
    const recolorTo: number[] = (t as any).recolorTo ?? [];
    h = fnv1a32UpdateInt(h, recolorFrom.length);
    for (let i = 0; i < recolorFrom.length; i++) {
        h = fnv1a32UpdateInt(h, recolorFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (recolorTo[i] ?? 0) | 0);
    }
    const retextureFrom: number[] = (t as any).retextureFrom ?? [];
    const retextureTo: number[] = (t as any).retextureTo ?? [];
    h = fnv1a32UpdateInt(h, retextureFrom.length);
    for (let i = 0; i < retextureFrom.length; i++) {
        h = fnv1a32UpdateInt(h, retextureFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (retextureTo[i] ?? 0) | 0);
    }
    h = fnv1a32UpdateInt(h, t.widthScale | 0);
    h = fnv1a32UpdateInt(h, t.heightScale | 0);
    h = fnv1a32UpdateInt(h, t.orientation | 0);
    h = fnv1a32UpdateInt(h, t.ambient | 0);
    h = fnv1a32UpdateInt(h, t.contrast | 0);
    return h | 0;
}

function hashBas(t: BasType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x42415354); // 'BAST'
    h = fnv1a32UpdateInt(h, t.idleSeqId | 0);
    h = fnv1a32UpdateInt(h, t.walkSeqId | 0);
    const mrt: Array<number[] | undefined> | undefined = (t as any).modelRotateTranslate;
    for (let i = 0; i < 12; i++) {
        const v = mrt ? mrt[i] : undefined;
        h = fnv1a32UpdateInt(h, v ? 1 : 0);
        if (v) {
            for (let k = 0; k < 6; k++) h = fnv1a32UpdateInt(h, (v[k] ?? 0) | 0);
        }
    }
    return h | 0;
}

function hashIdk(t: IdkType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x49444b54); // 'IDKT'
    h = fnv1a32UpdateInt(h, (t as any).bodyPartyId ?? (t as any).bodyPartId ?? -1);
    h = fnv1a32UpdateIntArray(h, (t as any).modelIds);
    const recolorFrom: number[] = (t as any).recolorFrom ?? [];
    const recolorTo: number[] = (t as any).recolorTo ?? [];
    h = fnv1a32UpdateInt(h, recolorFrom.length);
    for (let i = 0; i < recolorFrom.length; i++) {
        h = fnv1a32UpdateInt(h, recolorFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (recolorTo[i] ?? 0) | 0);
    }
    const retextureFrom: number[] = (t as any).retextureFrom ?? [];
    const retextureTo: number[] = (t as any).retextureTo ?? [];
    h = fnv1a32UpdateInt(h, retextureFrom.length);
    for (let i = 0; i < retextureFrom.length; i++) {
        h = fnv1a32UpdateInt(h, retextureFrom[i] | 0);
        h = fnv1a32UpdateInt(h, (retextureTo[i] ?? 0) | 0);
    }
    const ifModelIds: number[] = (t as any).ifModelIds ?? [-1, -1, -1, -1, -1];
    h = fnv1a32UpdateInt(h, ifModelIds.length);
    for (let i = 0; i < ifModelIds.length; i++) h = fnv1a32UpdateInt(h, ifModelIds[i] | 0);
    h = fnv1a32UpdateInt(h, (t as any).nonSelectable ? 1 : 0);
    return h | 0;
}

function hashInv(t: InvType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x494e5654); // 'INVT'
    h = fnv1a32UpdateInt(h, (t as any).itemCount ?? 0);
    return h | 0;
}

function hashMapScene(t: MapSceneType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4d53434e); // 'MSCN'
    h = fnv1a32UpdateInt(h, (t as any).spriteId ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).colorRgb ?? 0);
    h = fnv1a32UpdateInt(h, (t as any).enlarge ? 1 : 0);
    return h | 0;
}

function hashMapElement(t: MapElementType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x4d454c54); // 'MELT'
    h = fnv1a32UpdateInt(h, (t as any).spriteId ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).hoverSpriteId ?? -1);
    h = fnv1a32UpdateStringBytes(h, (t as any).name ?? "");
    h = fnv1a32UpdateInt(h, (t as any).textColor ?? 0);
    h = fnv1a32UpdateInt(h, (t as any).hoverTextColor ?? 0);
    h = fnv1a32UpdateInt(h, (t as any).textSize ?? 0);
    h = fnv1a32UpdateInt(h, (t as any).worldMapVisible ? 1 : 0);
    h = fnv1a32UpdateInt(h, (t as any).minimapVisible ? 1 : 0);
    h = fnv1a32UpdateInt(h, (t as any).randomizePosition ? 1 : 0);
    h = fnv1a32UpdateInt(h, (t as any).showInElementList ? 1 : 0);
    const ops: Array<string | undefined> = (t as any).ops ?? [];
    h = fnv1a32UpdateInt(h, ops.length);
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        h = fnv1a32UpdateInt(h, op ? 1 : 0);
        if (op) h = fnv1a32UpdateStringBytes(h, op);
    }
    h = fnv1a32UpdateParams(h, (t as any).params);
    return h | 0;
}

function hashStruct(t: StructType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x53545254); // 'STRT'
    h = fnv1a32UpdateParams(h, (t as any).params);
    return h | 0;
}

function hashVarPlayer(t: VarPlayerType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x56504c59); // 'VPLY'
    h = fnv1a32UpdateInt(h, (t as any).type ?? 0);
    return h | 0;
}

function hashVarClientInt(t: VarClientIntType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x56434949); // 'VCII'
    h = fnv1a32UpdateInt(h, (t as any).persist ? 1 : 0);
    return h | 0;
}

function hashVarClientStr(t: VarClientStrType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x56434953); // 'VCIS'
    h = fnv1a32UpdateInt(h, (t as any).persist ? 1 : 0);
    return h | 0;
}

function hashGraphicsDefaults(t: GraphicsDefaults): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x47524658); // 'GRFX'
    h = fnv1a32UpdateInt(h, (t as any).compass ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).mapEdge ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).mapScenes ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).mapFunctions ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).headIconsPk ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).headIconsPrayer ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).headIconsHint ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).mapMarkers ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).crosses ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).mapDots ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).scrollBars ?? -1);
    h = fnv1a32UpdateInt(h, (t as any).modIcons ?? -1);
    return h | 0;
}

function hashQuest(t: QuestType): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, 0x51554553); // 'QUES'
    h = fnv1a32UpdateStringBytes(h, (t as any).name ?? "");
    h = fnv1a32UpdateStringBytes(h, (t as any).sortName ?? "");

    const varps: any[] | null = (t as any).varps ?? null;
    h = fnv1a32UpdateInt(h, varps ? varps.length : 0);
    if (varps) {
        for (const v of varps) {
            h = fnv1a32UpdateInt(h, v.id | 0);
            h = fnv1a32UpdateInt(h, v.inProgressValue | 0);
            h = fnv1a32UpdateInt(h, v.completedValue | 0);
        }
    }

    const varbits: any[] | null = (t as any).varbits ?? null;
    h = fnv1a32UpdateInt(h, varbits ? varbits.length : 0);
    if (varbits) {
        for (const v of varbits) {
            h = fnv1a32UpdateInt(h, v.id | 0);
            h = fnv1a32UpdateInt(h, v.inProgressValue | 0);
            h = fnv1a32UpdateInt(h, v.completedValue | 0);
        }
    }

    h = fnv1a32UpdateInt(h, (t as any).type ?? 0);
    h = fnv1a32UpdateInt(h, (t as any).difficulty ?? 0);
    h = fnv1a32UpdateInt(h, (t as any).member ? 1 : 0);
    h = fnv1a32UpdateInt(h, (t as any).points ?? 0);

    const questRequirements: number[] | undefined = (t as any).questRequirements;
    h = fnv1a32UpdateInt(h, questRequirements ? questRequirements.length : 0);
    if (questRequirements) {
        for (const v of questRequirements) h = fnv1a32UpdateInt(h, v | 0);
    }

    const skillRequirements: any[] | undefined = (t as any).skillRequirements;
    h = fnv1a32UpdateInt(h, skillRequirements ? skillRequirements.length : 0);
    if (skillRequirements) {
        for (const r of skillRequirements) {
            h = fnv1a32UpdateInt(h, r.id | 0);
            h = fnv1a32UpdateInt(h, r.level | 0);
        }
    }

    h = fnv1a32UpdateInt(h, (t as any).pointsRequirement ?? 0);
    h = fnv1a32UpdateParams(h, (t as any).paramsMap);
    return h | 0;
}

function decodeAndHash(kind: Kind, cacheInfo: CacheInfo, bytes: Uint8Array, id: number): number | null {
    switch (kind) {
        case "underlay": {
            const r = decodeTypeFromBytes(UnderlayFloorType, cacheInfo, id, bytes);
            return r.ok ? hashUnderlay(r.value) : null;
        }
        case "overlay": {
            const r = decodeTypeFromBytes(OverlayFloorType, cacheInfo, id, bytes);
            return r.ok ? hashOverlay(r.value) : null;
        }
        case "varbit": {
            const r = decodeTypeFromBytes(VarBitType, cacheInfo, id, bytes);
            return r.ok ? hashVarBit(r.value) : null;
        }
        case "idk": {
            const r = decodeTypeFromBytes(IdkType, cacheInfo, id, bytes);
            return r.ok ? hashIdk(r.value) : null;
        }
        case "inv": {
            const r = decodeTypeFromBytes(InvType, cacheInfo, id, bytes);
            return r.ok ? hashInv(r.value) : null;
        }
        case "enum": {
            const r = decodeTypeFromBytes(EnumType, cacheInfo, id, bytes);
            return r.ok ? hashEnum(r.value) : null;
        }
        case "param": {
            const r = decodeTypeFromBytes(ParamType, cacheInfo, id, bytes);
            return r.ok ? hashParam(r.value) : null;
        }
        case "loc": {
            const r = decodeTypeFromBytes(LocType, cacheInfo, id, bytes);
            return r.ok ? hashLoc(r.value) : null;
        }
        case "npc": {
            const r = decodeTypeFromBytes(NpcType, cacheInfo, id, bytes);
            return r.ok ? hashNpc(r.value) : null;
        }
        case "obj": {
            const r = decodeTypeFromBytes(ObjType, cacheInfo, id, bytes);
            return r.ok ? hashObj(r.value) : null;
        }
        case "seq": {
            const r = decodeTypeFromBytes(SeqType, cacheInfo, id, bytes);
            return r.ok ? hashSeq(r.value) : null;
        }
        case "spotanim": {
            const r = decodeTypeFromBytes(SpotAnimType, cacheInfo, id, bytes);
            return r.ok ? hashSpotAnim(r.value) : null;
        }
        case "bas": {
            const r = decodeTypeFromBytes(BasType, cacheInfo, id, bytes);
            return r.ok ? hashBas(r.value) : null;
        }
        case "quest": {
            const r = decodeTypeFromBytes(QuestType, cacheInfo, id, bytes);
            return r.ok ? hashQuest(r.value) : null;
        }
        case "mapscene": {
            const r = decodeTypeFromBytes(MapSceneType, cacheInfo, id, bytes);
            return r.ok ? hashMapScene(r.value) : null;
        }
        case "mapelement": {
            const r = decodeTypeFromBytes(MapElementType, cacheInfo, id, bytes);
            return r.ok ? hashMapElement(r.value) : null;
        }
        case "struct": {
            const r = decodeTypeFromBytes(StructType, cacheInfo, id, bytes);
            return r.ok ? hashStruct(r.value) : null;
        }
        case "varplayer": {
            const r = decodeTypeFromBytes(VarPlayerType, cacheInfo, id, bytes);
            return r.ok ? hashVarPlayer(r.value) : null;
        }
        case "varclient_int": {
            const r = decodeTypeFromBytes(VarClientIntType, cacheInfo, id, bytes);
            return r.ok ? hashVarClientInt(r.value) : null;
        }
        case "varclient_str": {
            const r = decodeTypeFromBytes(VarClientStrType, cacheInfo, id, bytes);
            return r.ok ? hashVarClientStr(r.value) : null;
        }
        case "graphics_defaults": {
            // Not decoded from config archives; handled separately in main().
            return null;
        }
    }
}

function getIndexConfigBits(kind: Kind): number {
    switch (kind) {
        case "loc":
        case "obj":
            return 8;
        case "npc":
        case "seq":
            return 7;
        case "varbit":
            return 10;
        default:
            return 0;
    }
}

function getIndexConfigIndexId(kind: Kind): number {
    switch (kind) {
        case "loc":
            return Rs2IndexId.locs;
        case "npc":
            return Rs2IndexId.npcs;
        case "obj":
            return Rs2IndexId.objs;
        case "seq":
            return Rs2IndexId.seqs;
        case "varbit":
            return Rs2IndexId.varbits;
        default:
            return -1;
    }
}

function getConfigArchiveId(kind: Kind, cacheInfo: CacheInfo, rules: CacheRules): number {
    switch (kind) {
        case "underlay":
            return Dat2ConfigArchiveId.underlays;
        case "overlay":
            return Dat2ConfigArchiveId.overlays;
        case "idk":
            return Dat2ConfigArchiveId.identkits;
        case "inv":
            return Dat2ConfigArchiveId.inv;
        case "enum":
            return Dat2ConfigArchiveId.enums;
        case "param":
            return Dat2ConfigArchiveId.params;
        case "spotanim":
            return Dat2ConfigArchiveId.spotAnims;
        case "loc":
            return Dat2ConfigArchiveId.locs;
        case "npc":
            return Dat2ConfigArchiveId.npcs;
        case "obj":
            return Dat2ConfigArchiveId.objs;
        case "seq":
            return Dat2ConfigArchiveId.seqs;
        case "varbit":
            return Dat2ConfigArchiveId.varbits;
        case "bas":
            return cacheInfo.game === 1 /* Runescape */ ? Rs2ConfigArchiveId.bas : -1;
        case "quest":
            return cacheInfo.game === 1 /* Runescape */ ? Rs2ConfigArchiveId.quests : -1;
        case "mapscene":
            return cacheInfo.game === 1 /* Runescape */ ? Rs2ConfigArchiveId.mapScenes : -1;
        case "mapelement":
            if (rules.mapFunctions.mode === "osrs_archive") return OsrsConfigArchiveId.mapFunctions;
            if (rules.mapFunctions.mode === "rs2_archive") return Rs2ConfigArchiveId.mapFunctions;
            return -1;
        case "struct":
            return rules.mapFunctions.mode === "osrs_archive" ? OsrsConfigArchiveId.struct : -1;
        case "varplayer":
            return Dat2ConfigArchiveId.varps;
        case "varclient_int":
            return Dat2ConfigArchiveId.varClient;
        case "varclient_str":
            return Dat2ConfigArchiveId.varClientString;
        case "graphics_defaults":
            return -1;
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const caches = loadCacheInfos();
    const cacheInfo = pickCache(caches, args.cacheName);
    const cacheType = detectCacheType(cacheInfo);
    if (cacheType !== CacheType.Dat2) throw new Error(`Only dat2 caches are supported (got ${cacheType})`);

    const bundle = loadCacheFiles(cacheInfo);
    const cacheSystem = createCacheSystemFromFiles(cacheType, bundle, new JSCompressionHandler());
    const rules: CacheRules = computeCacheRules(cacheInfo, cacheSystem);

    const configIndex = cacheSystem.getIndex(Dat2IndexId.configs);

    const selectedKinds: Kind[] = (args.kinds?.length ? args.kinds : DEFAULT_KINDS) as Kind[];

    let totalMismatches = 0;
    for (const kind of selectedKinds) {
        const ids: number[] = [];
        const tsHashesById = new Map<number, number>();

        const wantIndexConfigs = rules.isIndexConfigs && ["loc", "npc", "obj", "seq", "varbit"].includes(kind);
        if (kind === "graphics_defaults") {
            const r = GraphicsDefaults.tryCreate(cacheInfo, cacheSystem);
            if (!r.ok) {
                console.log(`config-parity: kind=${kind} skipped (graphics defaults unavailable)`);
                continue;
            }
            ids.push(0);
            tsHashesById.set(0, hashGraphicsDefaults(r.value));
        } else if (wantIndexConfigs) {
            const idxId = getIndexConfigIndexId(kind);
            const bits = getIndexConfigBits(kind);
            const index = cacheSystem.tryGetIndex(idxId);
            if (!index) {
                console.log(`config-parity: kind=${kind} skipped (missing index ${idxId})`);
                continue;
            }
            const archiveIds = index.getArchiveIds();
            outerIndex: for (let ai = 0; ai < archiveIds.length; ai++) {
                const archiveId = archiveIds[ai];
                const fileIds = index.getFileIds(archiveId);
                if (fileIds) {
                    for (let fi = 0; fi < fileIds.length; fi++) {
                        if (ids.length >= args.limit) break outerIndex;
                        const fileId = fileIds[fi];
                        const typeId = (archiveId << bits) | fileId;
                        const file = index.tryGetFile(archiveId, fileId);
                        if (!file) continue;
                        const hash = decodeAndHash(kind, cacheInfo, file.data, typeId);
                        if (hash === null) continue;
                        ids.push(typeId);
                        tsHashesById.set(typeId, hash);
                    }
                } else {
                    const n = index.getFileCount(archiveId);
                    for (let fileId = 0; fileId < n; fileId++) {
                        if (ids.length >= args.limit) break outerIndex;
                        const typeId = (archiveId << bits) | fileId;
                        const file = index.tryGetFile(archiveId, fileId);
                        if (!file) continue;
                        const hash = decodeAndHash(kind, cacheInfo, file.data, typeId);
                        if (hash === null) continue;
                        ids.push(typeId);
                        tsHashesById.set(typeId, hash);
                    }
                }
            }
        } else {
            const archiveId = getConfigArchiveId(kind, cacheInfo, rules);
            if (archiveId < 0) {
                console.log(`config-parity: kind=${kind} skipped (no archive for this cache)`);
                continue;
            }
            if (!configIndex.archiveExists(archiveId)) {
                console.log(`config-parity: kind=${kind} skipped (missing archive ${archiveId})`);
                continue;
            }
            const fileIds = configIndex.getFileIds(archiveId);
            const n = fileIds ? fileIds.length : configIndex.getFileCount(archiveId);
            for (let i = 0; i < n && ids.length < args.limit; i++) {
                const id = fileIds ? fileIds[i] : i;
                const file = configIndex.tryGetFile(archiveId, id);
                if (!file) continue;
                const hash = decodeAndHash(kind, cacheInfo, file.data, id);
                if (hash === null) continue;
                ids.push(id);
                tsHashesById.set(id, hash);
            }
        }

        if (ids.length === 0) {
            console.log(`config-parity: kind=${kind} ids=0 (skipped)`);
            continue;
        }

        const cpp = spawnSync(
            "./cpp/build/rs_cli",
            [
                "config_type_hashes",
                "--cache",
                cacheInfo.name,
                "--game",
                String(getGameTypeName(cacheInfo.game)),
                "--revision",
                String(cacheInfo.revision),
                "--kind",
                kind,
                "--ids",
                ids.join(","),
            ],
            { encoding: "utf8" },
        );
        if (cpp.status !== 0) {
            throw new Error(`rs_cli failed kind=${kind} (code=${cpp.status}): ${cpp.stderr || cpp.stdout}`);
        }

        const parsed = JSON.parse(cpp.stdout) as {
            kind: string;
            entries: Array<{ id: number; ok: boolean; hash?: number; status?: string }>;
        };

        const cppById = new Map<number, (typeof parsed.entries)[number]>();
        for (const e of parsed.entries) cppById.set(e.id, e);

        let mismatches = 0;
        for (const id of ids) {
            const tsHash = tsHashesById.get(id);
            if (tsHash === undefined) continue;
            const c = cppById.get(id);
            if (!c) throw new Error(`Missing C++ entry kind=${kind} id=${id}`);
            if (!c.ok) throw new Error(`C++ failed kind=${kind} id=${id}: ${c.status ?? "?"}`);
            if ((c.hash ?? 0) !== tsHash) {
                mismatches++;
                console.error(`hash mismatch kind=${kind} id=${id}: ts=${tsHash} cpp=${c.hash}`);
            }
        }

        totalMismatches += mismatches;
        console.log(`config-parity: kind=${kind} ids=${ids.length} mismatches=${mismatches}`);
    }

    if (totalMismatches) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
