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
import { LineNoiseOperation } from "./LineNoiseOperation";
import { MandelbrotOperation } from "./MandelbrotOperation";
import { MirrorOperation } from "./MirrorOperation";
import { LerpOperation } from "./LerpOperation";
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

export class TextureOperationFactory {
    static instantiate(typeId: number): TextureOperation {
        switch (typeId) {
            case 0:
                return new ConstantMonochromeOperation();
            case 1:
                return new ConstantColourOperation();
            case 2:
                return new HorizontalGradientOperation();
            case 3:
                return new VerticalGradientOperation();
            case 4:
                return new BricksOperation();
            case 5:
                return new BlurOperation();
            case 6:
                return new ClampOperation();
            case 7:
                return new ArithmeticOperation();
            case 8:
                return new CurveOperation();
            case 9:
                return new MirrorOperation();
            case 10:
                return new GradientOperation();
            case 11:
                return new ColourStripOperation();
            case 12:
                return new DiagonalGradientOperation();
            case 13:
                return new PseudoRandomNoiseOperation();
            case 14:
                return new WeaveOperation();
            case 15:
                return new VoronoiNoiseOperation();
            case 16:
                return new HerringboneOperation();
            case 17:
                return new HslOperation();
            case 18:
                return new TilingSpriteOperation();
            case 19:
                return new TrigWarpOperation();
            case 20:
                return new TilingOperation();
            case 21:
                return new LerpOperation();
            case 22:
                return new InvertOperation();
            case 23:
                return new KaleidoscopeOperation();
            case 24:
                return new GrayScaleOperation();
            case 25:
                return new BrightnessOperation();
            case 26:
                return new RangeThresholdOperation();
            case 27:
                return new SquareWaveformOperation();
            case 28:
                return new IrregularBricksOperation();
            case 29:
                return new ShapeRasterizerOperation();
            case 30:
                return new RangeOperation();
            case 31:
                return new MandelbrotOperation();
            case 32:
                return new EmbossOperation();
            case 33:
                return new NormalMapOperation();
            case 34:
                return new PerlinNoiseOperation();
            case 35:
                return new MonochromeEdgeDetectorOperation();
            case 36:
                return new TextureSourceOperation();
            case 37:
                return new WavyCrossOperation();
            case 38:
                return new LineNoiseOperation();
            case 39:
                return new SpriteSourceOperation();
            default:
                throw new Error("Unknown texture operation: " + typeId);
        }
    }

    static create(buffer: ByteBuffer): TextureOperation {
        const operationId = buffer.readUnsignedByte();
        const typeId = buffer.readUnsignedByte();
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
