import { ByteBuffer } from "../../../io/ByteBuffer";
import { ArithmeticOperation } from "./ArithmeticOperation";
import { BlurOperation } from "./BlurOperation";
import { BricksOperation } from "./BricksOperation";
import { BrightnessOperation } from "./BrightnessOperation";
import { ClampOperation } from "./ClampOperation";
import { ColourStripOperation } from "./ColourStripOperation";
import { ConstantColourOperation } from "./ConstantColourOperation";
import { ConstantMonochromeOperation } from "./ConstantMonochromeOperation";
import { CurveOperation } from "./CurveOperation";
import { DiagonalGradientOperation } from "./DiagonalGradientOperation";
import { EmbossOperation } from "./EmbossOperation";
import { GradientOperation } from "./GradientOperation";
import { GrayScaleOperation } from "./GrayScaleOperation";
import { HerringboneOperation } from "./HerringboneOperation";
import { HorizontalGradientOperation } from "./HorizontalGradientOperation";
import { HslOperation } from "./HslOperation";
import { InvertOperation } from "./InvertOperation";
import { IrregularBricksOperation } from "./IrregularBricksOperation";
import { KaleidoscopeOperation } from "./KaleidoscopeOperation";
import { LerpOperation } from "./LerpOperation";
import { LineNoiseOperation } from "./LineNoiseOperation";
import { MandelbrotOperation } from "./MandelbrotOperation";
import { MirrorOperation } from "./MirrorOperation";
import { MonochromeEdgeDetectorOperation } from "./MonochromeEdgeDetectorOperation";
import { NormalMapOperation } from "./NormalMapOperation";
import { PerlinNoiseOperation } from "./PerlinNoiseOperation";
import { PseudoRandomNoiseOperation } from "./PseudoRandomNoiseOperation";
import { RangeOperation } from "./RangeOperation";
import { RangeThresholdOperation } from "./RangeThresholdOperation";
import { ShapeRasterizerOperation } from "./ShapeRasterizerOperation";
import { SpriteSourceOperation } from "./SpriteSourceOperation";
import { SquareWaveformOperation } from "./SquareWaveformOperation";
import { TextureOperation } from "./TextureOperation";
import { TextureSourceOperation } from "./TextureSourceOperation";
import { TilingOperation } from "./TilingOperation";
import { TilingSpriteOperation } from "./TilingSpriteOperation";
import { TrigWarpOperation } from "./TrigWarpOperation";
import { VerticalGradientOperation } from "./VerticalGradientOperation";
import { VoronoiNoiseOperation } from "./VoronoiNoiseOperation";
import { WavyCrossOperation } from "./WavyCrossOperation";
import { WeaveOperation } from "./WeaveOperation";

export enum TextureOperationTypeId {
    ConstantMonochrome = 0,
    ConstantColour = 1,
    HorizontalGradient = 2,
    VerticalGradient = 3,
    Bricks = 4,
    Blur = 5,
    Clamp = 6,
    Arithmetic = 7,
    Curve = 8,
    Mirror = 9,
    Gradient = 10,
    ColourStrip = 11,
    DiagonalGradient = 12,
    PseudoRandomNoise = 13,
    Weave = 14,
    VoronoiNoise = 15,
    Herringbone = 16,
    Hsl = 17,
    TilingSprite = 18,
    TrigWarp = 19,
    Tiling = 20,
    Lerp = 21,
    Invert = 22,
    Kaleidoscope = 23,
    GrayScale = 24,
    Brightness = 25,
    RangeThreshold = 26,
    SquareWaveform = 27,
    IrregularBricks = 28,
    ShapeRasterizer = 29,
    Range = 30,
    Mandelbrot = 31,
    Emboss = 32,
    NormalMap = 33,
    PerlinNoise = 34,
    MonochromeEdgeDetector = 35,
    TextureSource = 36,
    WavyCross = 37,
    LineNoise = 38,
    SpriteSource = 39,
}

export class TextureOperationFactory {
    static instantiate(typeId: TextureOperationTypeId): TextureOperation {
        switch (typeId) {
            case TextureOperationTypeId.ConstantMonochrome:
                return new ConstantMonochromeOperation();
            case TextureOperationTypeId.ConstantColour:
                return new ConstantColourOperation();
            case TextureOperationTypeId.HorizontalGradient:
                return new HorizontalGradientOperation();
            case TextureOperationTypeId.VerticalGradient:
                return new VerticalGradientOperation();
            case TextureOperationTypeId.Bricks:
                return new BricksOperation();
            case TextureOperationTypeId.Blur:
                return new BlurOperation();
            case TextureOperationTypeId.Clamp:
                return new ClampOperation();
            case TextureOperationTypeId.Arithmetic:
                return new ArithmeticOperation();
            case TextureOperationTypeId.Curve:
                return new CurveOperation();
            case TextureOperationTypeId.Mirror:
                return new MirrorOperation();
            case TextureOperationTypeId.Gradient:
                return new GradientOperation();
            case TextureOperationTypeId.ColourStrip:
                return new ColourStripOperation();
            case TextureOperationTypeId.DiagonalGradient:
                return new DiagonalGradientOperation();
            case TextureOperationTypeId.PseudoRandomNoise:
                return new PseudoRandomNoiseOperation();
            case TextureOperationTypeId.Weave:
                return new WeaveOperation();
            case TextureOperationTypeId.VoronoiNoise:
                return new VoronoiNoiseOperation();
            case TextureOperationTypeId.Herringbone:
                return new HerringboneOperation();
            case TextureOperationTypeId.Hsl:
                return new HslOperation();
            case TextureOperationTypeId.TilingSprite:
                return new TilingSpriteOperation();
            case TextureOperationTypeId.TrigWarp:
                return new TrigWarpOperation();
            case TextureOperationTypeId.Tiling:
                return new TilingOperation();
            case TextureOperationTypeId.Lerp:
                return new LerpOperation();
            case TextureOperationTypeId.Invert:
                return new InvertOperation();
            case TextureOperationTypeId.Kaleidoscope:
                return new KaleidoscopeOperation();
            case TextureOperationTypeId.GrayScale:
                return new GrayScaleOperation();
            case TextureOperationTypeId.Brightness:
                return new BrightnessOperation();
            case TextureOperationTypeId.RangeThreshold:
                return new RangeThresholdOperation();
            case TextureOperationTypeId.SquareWaveform:
                return new SquareWaveformOperation();
            case TextureOperationTypeId.IrregularBricks:
                return new IrregularBricksOperation();
            case TextureOperationTypeId.ShapeRasterizer:
                return new ShapeRasterizerOperation();
            case TextureOperationTypeId.Range:
                return new RangeOperation();
            case TextureOperationTypeId.Mandelbrot:
                return new MandelbrotOperation();
            case TextureOperationTypeId.Emboss:
                return new EmbossOperation();
            case TextureOperationTypeId.NormalMap:
                return new NormalMapOperation();
            case TextureOperationTypeId.PerlinNoise:
                return new PerlinNoiseOperation();
            case TextureOperationTypeId.MonochromeEdgeDetector:
                return new MonochromeEdgeDetectorOperation();
            case TextureOperationTypeId.TextureSource:
                return new TextureSourceOperation();
            case TextureOperationTypeId.WavyCross:
                return new WavyCrossOperation();
            case TextureOperationTypeId.LineNoise:
                return new LineNoiseOperation();
            case TextureOperationTypeId.SpriteSource:
                return new SpriteSourceOperation();
            default:
                throw new Error("Unknown texture operation: " + typeId);
        }
    }

    static create(buffer: ByteBuffer): TextureOperation {
        const operationId = buffer.readUnsignedByte();
        const typeId = buffer.readUnsignedByte() as TextureOperationTypeId;
        // console.log("type", typeId, "id", operationId);
        const operation = TextureOperationFactory.instantiate(typeId);
        operation.operationId = operationId;
        operation.cacheSlotCount = buffer.readUnsignedByte();
        const propertyCount = buffer.readUnsignedByte();
        for (let i = 0; i < propertyCount; i++) {
            const propertyId = buffer.readUnsignedByte();
            operation.decode(propertyId, buffer);
        }
        operation.init();
        return operation;
    }
}
