import { useSearchParams } from "react-router-dom";

import EntityViewerApp from "./entityviewer/EntityViewerApp";
import MapViewerApp from "./mapviewer/MapViewerApp";

export default function App(): JSX.Element {
    const [searchParams] = useSearchParams();
    if (searchParams.get("tool") === "entity") {
        return <EntityViewerApp />;
    }
    return <MapViewerApp />;
}
