import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { Map, Moon, Navigation } from "lucide-react";
import { CampusScene, type HorrorAtmosphereEvent } from "./game/CampusScene";

const initialAtmosphere: HorrorAtmosphereEvent = {
  timeLabel: "00:47",
  statusLabel: "校园静默",
  stage: 3,
  stageName: "夜探医学院",
  realityDistortion: 0.46,
};

function App() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [atmosphere, setAtmosphere] = useState<HorrorAtmosphereEvent>(initialAtmosphere);

  useEffect(() => {
    const handleAtmosphere = (event: Event) => {
      setAtmosphere((event as CustomEvent<HorrorAtmosphereEvent>).detail);
    };

    window.addEventListener("zju-horror-atmosphere", handleAtmosphere);
    return () => window.removeEventListener("zju-horror-atmosphere", handleAtmosphere);
  }, []);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: "#050908",
      scene: CampusScene,
      physics: {
        default: "arcade",
        arcade: { debug: false },
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: true,
        pixelArt: false,
      },
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  const unstable = atmosphere.statusLabel !== "校园静默" || atmosphere.timeLabel !== "00:47";

  return (
    <main className="appShell" data-distortion={atmosphere.realityDistortion > 0.62 ? "high" : "low"}>
      <section className="gameFrame" aria-label="浙大夜惊魂 2.5D 校园地图">
        <div ref={containerRef} className="gameCanvas" />
        <div className="vignette" />
        <div className="scanline" />
        <div className="grain" />
        <div className="signalTear" />
      </section>

      <aside className={unstable ? "topHud unstable" : "topHud"} aria-label="地图状态">
        <div className="brandBlock">
          <Map size={18} />
          <div>
            <strong>浙大夜惊魂</strong>
            <span>{atmosphere.stageName}</span>
          </div>
        </div>
        <div className="metric">
          <Moon size={16} />
          <span>{atmosphere.timeLabel}</span>
        </div>
        <div className="metric">
          <Navigation size={16} />
          <span>{atmosphere.statusLabel}</span>
        </div>
      </aside>
    </main>
  );
}

export default App;
