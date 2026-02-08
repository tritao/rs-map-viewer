import { CacheInfo, GameType } from "../../src/rs/cache/CacheInfo";
import { decodeTypeFromBytes } from "../../src/rs/config/decode/decodeType";
import { BasType } from "../../src/rs/config/bastype/BasType";
import { GraphicsDefaults } from "../../src/rs/config/defaults/GraphicsDefaults";
import { IdkType } from "../../src/rs/config/idktype/IdkType";
import { InvType } from "../../src/rs/config/invtype/InvType";
import { LocType } from "../../src/rs/config/loctype/LocType";
import { MapSceneType } from "../../src/rs/config/mapscenetype/MapSceneType";
import { MapElementType } from "../../src/rs/config/meltype/MapElementType";
import { NpcType } from "../../src/rs/config/npctype/NpcType";
import { ObjStackability } from "../../src/rs/config/objtype/ObjStackability";
import { ObjType } from "../../src/rs/config/objtype/ObjType";
import { QuestType } from "../../src/rs/config/questtype/QuestType";
import { StructType } from "../../src/rs/config/structtype/StructType";
import { EnumType } from "../../src/rs/config/enumtype/EnumType";
import { VarClientIntType } from "../../src/rs/config/vartype/client/VarClientIntType";
import { VarClientStrType } from "../../src/rs/config/vartype/client/VarClientStrType";
import { VarPlayerType } from "../../src/rs/config/vartype/player/VarPlayerType";
import { VarBitType } from "../../src/rs/config/vartype/bit/VarBitType";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function bytes(...v: number[]): Uint8Array {
    return new Uint8Array(v);
}

const cacheInfo = new CacheInfo("test", GameType.Runescape, "test", 500, "1970-01-01", 0);

// VarBitType: [opcode=1][baseVar=u16][start=u8][end=u8][opcode=0]
{
    const encoded = bytes(1, 0x01, 0x23, 4, 9, 0);
    const decoded = decodeTypeFromBytes(VarBitType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`VarBitType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.baseVar === 0x0123, "VarBitType baseVar mismatch");
    assert(decoded.value.startBit === 4, "VarBitType startBit mismatch");
    assert(decoded.value.endBit === 9, "VarBitType endBit mismatch");
}

// LocType: [2]["door\\0"][30]["Open\\0"][0]
{
    const encoded = bytes(
        2,
        "d".charCodeAt(0),
        "o".charCodeAt(0),
        "o".charCodeAt(0),
        "r".charCodeAt(0),
        0,
        30,
        "O".charCodeAt(0),
        "p".charCodeAt(0),
        "e".charCodeAt(0),
        "n".charCodeAt(0),
        0,
        0,
    );
    const decoded = decodeTypeFromBytes(LocType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`LocType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.name === "door", "LocType name mismatch");
    assert(decoded.value.actions[0] === "Open", "LocType action[0] mismatch");
    assert(decoded.value.isInteractive === 1, "LocType isInteractive mismatch");
}

// NpcType: [2]["bob\\0"][12][2][30]["Talk-to\\0"][95][0x0010][0]
{
    const encoded = bytes(
        2,
        "b".charCodeAt(0),
        "o".charCodeAt(0),
        "b".charCodeAt(0),
        0,
        12,
        2,
        30,
        "T".charCodeAt(0),
        "a".charCodeAt(0),
        "l".charCodeAt(0),
        "k".charCodeAt(0),
        "-".charCodeAt(0),
        "t".charCodeAt(0),
        "o".charCodeAt(0),
        0,
        95,
        0,
        0x10,
        0,
    );
    const decoded = decodeTypeFromBytes(NpcType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`NpcType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.name === "bob", "NpcType name mismatch");
    assert(decoded.value.size === 2, "NpcType size mismatch");
    assert(decoded.value.actions[0] === "Talk-to", "NpcType actions[0] mismatch");
    assert(decoded.value.combatLevel === 0x10, "NpcType combatLevel mismatch");
}

// ObjType: [2]["item\\0"][11][30]["hidden\\0"][0]
{
    const encoded = bytes(
        2,
        "i".charCodeAt(0),
        "t".charCodeAt(0),
        "e".charCodeAt(0),
        "m".charCodeAt(0),
        0,
        11,
        30,
        "h".charCodeAt(0),
        "i".charCodeAt(0),
        "d".charCodeAt(0),
        "d".charCodeAt(0),
        "e".charCodeAt(0),
        "n".charCodeAt(0),
        0,
        0,
    );
    const decoded = decodeTypeFromBytes(ObjType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`ObjType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.name === "item", "ObjType name mismatch");
    assert(decoded.value.stackability === ObjStackability.ALWAYS, "ObjType stackability mismatch");
    assert(
        decoded.value.groundActions[0] === null,
        "ObjType groundActions[0] should be cleared when hidden",
    );
}

// ---- Additional golden decode cases for porting/parity ----

// InvType: [opcode=2][itemCount=u16][opcode=0]
{
    const encoded = bytes(2, 0x01, 0x00, 0);
    const decoded = decodeTypeFromBytes(InvType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`InvType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.itemCount === 0x0100, "InvType itemCount mismatch");
}

// IdkType: [1][bodyPart=u8][2][count=u8][modelIds=u16*count][3][40][count][from,to]*[41]...[60..][0]
{
    const encoded = bytes(
        1,
        7, // body part
        2,
        2, // modelCount
        0x00,
        0x2a,
        0x01,
        0x02, // models: 42, 258
        3, // nonSelectable
        40,
        1, // recolor count
        0x00,
        0x10,
        0x00,
        0x20, // from=16,to=32
        41,
        1, // retexture count
        0x00,
        0x30,
        0x00,
        0x40, // from=48,to=64
        60,
        0x00,
        0x99, // ifModelIds[0]=153
        0,
    );
    const decoded = decodeTypeFromBytes(IdkType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`IdkType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.bodyPartyId === 7, "IdkType bodyPartyId mismatch");
    assert(decoded.value.modelIds.length === 2, "IdkType modelIds length mismatch");
    assert(decoded.value.modelIds[0] === 42, "IdkType modelIds[0] mismatch");
    assert(decoded.value.modelIds[1] === 258, "IdkType modelIds[1] mismatch");
    assert(decoded.value.nonSelectable === true, "IdkType nonSelectable mismatch");
    assert(decoded.value.recolorFrom.length === 1, "IdkType recolorFrom length mismatch");
    assert(decoded.value.recolorFrom[0] === 16, "IdkType recolorFrom[0] mismatch");
    assert(decoded.value.recolorTo[0] === 32, "IdkType recolorTo[0] mismatch");
    assert(decoded.value.retextureFrom[0] === 48, "IdkType retextureFrom[0] mismatch");
    assert(decoded.value.retextureTo[0] === 64, "IdkType retextureTo[0] mismatch");
    assert(decoded.value.ifModelIds[0] === 0x0099, "IdkType ifModelIds[0] mismatch");
}

// BasType: [1][idle=u16][walk=u16][27][bodyPart=u8][short*6][0]
{
    const encoded = bytes(
        1,
        0x00,
        0x10, // idle=16
        0xff,
        0xff, // walk=-1
        27,
        2, // bodyPartId
        0x00,
        0x01, // 1
        0x00,
        0x02, // 2
        0xff,
        0xff, // -1
        0x00,
        0x04, // 4
        0xff,
        0xfe, // -2
        0x00,
        0x06, // 6
        0,
    );
    const decoded = decodeTypeFromBytes(BasType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`BasType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.idleSeqId === 16, "BasType idleSeqId mismatch");
    assert(decoded.value.walkSeqId === -1, "BasType walkSeqId mismatch");
    assert(decoded.value.modelRotateTranslate !== undefined, "BasType modelRotateTranslate missing");
    const v = decoded.value.modelRotateTranslate?.[2];
    assert(v !== undefined, "BasType modelRotateTranslate[2] missing");
    assert(v.length === 6, "BasType modelRotateTranslate[2] length mismatch");
    assert(v[0] === 1 && v[1] === 2 && v[2] === -1 && v[3] === 4 && v[4] === -2 && v[5] === 6, "BasType modelRotateTranslate[2] values mismatch");
}

// MapSceneType: [1][sprite=u16][2][rgb=medium][3][4][0] (4 resets spriteId)
{
    const encoded = bytes(1, 0x00, 0x7b, 2, 0x11, 0x22, 0x33, 3, 4, 0);
    const decoded = decodeTypeFromBytes(MapSceneType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`MapSceneType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.spriteId === -1, "MapSceneType spriteId mismatch");
    assert(decoded.value.colorRgb === 0x112233, "MapSceneType colorRgb mismatch");
    assert(decoded.value.enlarge === true, "MapSceneType enlarge mismatch");
}

// MapElementType: [1][sprite bigSmart=u16][2][hover bigSmart=u16][3][name\\0][4][rgb=medium][10][op\\0][16][0]
{
    const encoded = bytes(
        1,
        0x00,
        0x2a, // spriteId=42
        2,
        0x00,
        0x2b, // hover=43
        3,
        "m".charCodeAt(0),
        "a".charCodeAt(0),
        "p".charCodeAt(0),
        0,
        4,
        0x01,
        0x02,
        0x03,
        10,
        "O".charCodeAt(0),
        "p".charCodeAt(0),
        0,
        16,
        0,
    );
    const decoded = decodeTypeFromBytes(MapElementType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`MapElementType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.spriteId === 42, "MapElementType spriteId mismatch");
    assert(decoded.value.hoverSpriteId === 43, "MapElementType hoverSpriteId mismatch");
    assert(decoded.value.name === "map", "MapElementType name mismatch");
    assert(decoded.value.textColor === 0x010203, "MapElementType textColor mismatch");
    assert(decoded.value.ops[0] === "Op", "MapElementType ops[0] mismatch");
    assert(decoded.value.showInElementList === false, "MapElementType showInElementList mismatch");
}

// StructType: [249][paramsMap][0]
// paramsMap = [count=2][isString=0][key=0x000102][i32=0x11223344][isString=1][key=0x000103]["hi\\0"]
{
    const encoded = bytes(
        249,
        2, // count
        0,
        0x00,
        0x01,
        0x02, // key=0x0102
        0x11,
        0x22,
        0x33,
        0x44, // int
        1,
        0x00,
        0x01,
        0x03, // key=0x0103
        "h".charCodeAt(0),
        "i".charCodeAt(0),
        0,
        0,
    );
    const decoded = decodeTypeFromBytes(StructType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`StructType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.params.get(0x000102) === 0x11223344, "StructType params int mismatch");
    assert(decoded.value.params.get(0x000103) === "hi", "StructType params string mismatch");
}

// EnumType: cover string-table decode (opcode=5) and default string.
// [1]['i'][2]['s'][3]["none\\0"][5][count=u16][key=i32]["a\\0"][key=i32]["b\\0"][0]
{
    const encoded = bytes(
        1,
        "i".charCodeAt(0),
        2,
        "s".charCodeAt(0),
        3,
        "n".charCodeAt(0),
        "o".charCodeAt(0),
        "n".charCodeAt(0),
        "e".charCodeAt(0),
        0,
        5,
        0x00,
        0x02, // outputCount=2
        0x01,
        0x02,
        0x03,
        0x04, // key=0x01020304
        "a".charCodeAt(0),
        0,
        0x00,
        0x00,
        0x00,
        0x2a, // key=42
        "b".charCodeAt(0),
        0,
        0,
    );
    const decoded = decodeTypeFromBytes(EnumType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`EnumType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.inputType === "i", "EnumType inputType mismatch");
    assert(decoded.value.outputType === "s", "EnumType outputType mismatch");
    assert(decoded.value.defaultString === "none", "EnumType defaultString mismatch");
    assert(decoded.value.outputCount === 2, "EnumType outputCount mismatch");
    assert(decoded.value.keys.length === 2, "EnumType keys length mismatch");
    assert(decoded.value.keys[0] === 0x01020304, "EnumType keys[0] mismatch");
    assert(decoded.value.keys[1] === 42, "EnumType keys[1] mismatch");
    assert(decoded.value.stringValues.length === 2, "EnumType stringValues length mismatch");
    assert(decoded.value.stringValues[0] === "a", "EnumType stringValues[0] mismatch");
    assert(decoded.value.stringValues[1] === "b", "EnumType stringValues[1] mismatch");
}

// QuestType: [1][verString][2][verString][8][9][points=u8][249][params][0]
{
    const encoded = bytes(
        1,
        0,
        "Q".charCodeAt(0),
        0,
        2,
        0,
        "S".charCodeAt(0),
        0,
        8,
        9,
        5,
        249,
        1, // count
        0,
        0x00,
        0x00,
        0x10, // key=16
        0x00,
        0x00,
        0x00,
        0x2a, // int=42
        0,
    );
    const decoded = decodeTypeFromBytes(QuestType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`QuestType decode failed: ${decoded.error.kind}`);
    }
    decoded.value.post();
    assert(decoded.value.name === "Q", "QuestType name mismatch");
    assert(decoded.value.sortName === "S", "QuestType sortName mismatch");
    assert(decoded.value.member === true, "QuestType member mismatch");
    assert(decoded.value.points === 5, "QuestType points mismatch");
    assert(decoded.value.paramsMap?.get(16) === 42, "QuestType paramsMap mismatch");
}

// VarPlayerType: [5][u16][0]
{
    const encoded = bytes(5, 0x12, 0x34, 0);
    const decoded = decodeTypeFromBytes(VarPlayerType, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`VarPlayerType decode failed: ${decoded.error.kind}`);
    }
    assert(decoded.value.type === 0x1234, "VarPlayerType type mismatch");
}

// VarClientIntType/VarClientStrType: [2][0]
{
    const enc = bytes(2, 0);
    const a = decodeTypeFromBytes(VarClientIntType, cacheInfo, 0, enc);
    const b = decodeTypeFromBytes(VarClientStrType, cacheInfo, 0, enc);
    if (!a.ok) throw new Error(`VarClientIntType decode failed: ${a.error.kind}`);
    if (!b.ok) throw new Error(`VarClientStrType decode failed: ${b.error.kind}`);
    assert(a.value.persist === true, "VarClientIntType persist mismatch");
    assert(b.value.persist === true, "VarClientStrType persist mismatch");
}

// GraphicsDefaults: [2][bigSmart*u11][0] (use u16 form)
{
    const encoded = bytes(
        2,
        0x00,
        0x01,
        0x00,
        0x02,
        0x00,
        0x03,
        0x00,
        0x04,
        0x00,
        0x05,
        0x00,
        0x06,
        0x00,
        0x07,
        0x00,
        0x08,
        0x00,
        0x09,
        0x00,
        0x0a,
        0x00,
        0x0b,
        0,
    );
    const decoded = decodeTypeFromBytes(GraphicsDefaults, cacheInfo, 0, encoded);
    if (!decoded.ok) {
        throw new Error(`GraphicsDefaults decode failed: ${decoded.error.kind}`);
    }
    const t = decoded.value;
    assert(t.compass === 1, "GraphicsDefaults compass mismatch");
    assert(t.mapEdge === 2, "GraphicsDefaults mapEdge mismatch");
    assert(t.mapScenes === 3, "GraphicsDefaults mapScenes mismatch");
    assert(t.headIconsPk === 4, "GraphicsDefaults headIconsPk mismatch");
    assert(t.headIconsPrayer === 5, "GraphicsDefaults headIconsPrayer mismatch");
    assert(t.headIconsHint === 6, "GraphicsDefaults headIconsHint mismatch");
    assert(t.mapMarkers === 7, "GraphicsDefaults mapMarkers mismatch");
    assert(t.crosses === 8, "GraphicsDefaults crosses mismatch");
    assert(t.mapDots === 9, "GraphicsDefaults mapDots mismatch");
    assert(t.scrollBars === 10, "GraphicsDefaults scrollBars mismatch");
    assert(t.modIcons === 11, "GraphicsDefaults modIcons mismatch");
}

console.log("config-golden: ok");
