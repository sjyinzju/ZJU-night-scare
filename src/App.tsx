import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { BadgeCheck, CircleDot, Map, Moon, RadioTower, Route, ScrollText } from "lucide-react";
import { CampusScene, type GameHudEvent } from "./game/CampusScene";

const initialHud: GameHudEvent = {
  place: "",
  prompt: "",
  story: "载入紫金港夜间地图中...",
  tasks: [],
};

function App() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hud, setHud] = useState<GameHudEvent>(initialHud);

  useEffect(() => {
    const handleHud = (event: Event) => {
      const detail = (event as CustomEvent<GameHudEvent>).detail;
      setHud((previous) => ({
        place: detail.place,
        prompt: detail.prompt,
        story: detail.story || previous.story,
        tasks: detail.tasks,
      }));
    };
    window.addEventListener("zju-horror-hud", handleHud);
    return () => window.removeEventListener("zju-horror-hud", handleHud);
  }, []);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: "#0b1110",
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

  const completed = hud.tasks.filter((task) => task.done).length;

  return (
    <main className="appShell">
      <section className="gameFrame" aria-label="浙大恐怖故事 2.5D 地图原型">
        <div ref={containerRef} className="gameCanvas" />
        <div className="vignette" />
        <div className="scanline" />
      </section>

      <aside className="topHud">
        <div className="brandBlock">
          <Map size={18} />
          <div>
            <strong>浙大夜巡地图</strong>
            <span>2.5D story prototype</span>
          </div>
        </div>
        <div className="metric">
          <Moon size={16} />
          <span>00:47</span>
        </div>
        <div className="metric">
          <Route size={16} />
          <span>紫金港</span>
        </div>
      </aside>

      <aside className="sidePanel">
        <header>
          <RadioTower size={18} />
          <span>任务链</span>
          <b>
            {completed}/{hud.tasks.length || 4}
          </b>
        </header>
        <div className="taskList">
          {(hud.tasks.length ? hud.tasks : initialHud.tasks).map((task) => (
            <div className={task.done ? "task done" : "task"} key={task.id}>
              {task.done ? <BadgeCheck size={18} /> : <CircleDot size={18} />}
              <div>
                <strong>{task.title}</strong>
                <span>{task.place}</span>
              </div>
            </div>
          ))}
          {!hud.tasks.length && (
            <>
              <div className="task">
                <CircleDot size={18} />
                <div>
                  <strong>核对闭馆记录</strong>
                  <span>基础图书馆</span>
                </div>
              </div>
              <div className="task">
                <CircleDot size={18} />
                <div>
                  <strong>追踪湖面信号</strong>
                  <span>启真湖</span>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>

      <section className="storyPanel">
        <div className="placeLine">
          <ScrollText size={17} />
          <span>{hud.place || "紫金港校区"}</span>
        </div>
        <p>{hud.story}</p>
        <div className={hud.prompt ? "interact visible" : "interact"}>{hud.prompt || "WASD / 方向键移动"}</div>
      </section>
    </main>
  );
}

export default App;
