import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { InteriorAssetState } from "./game/interior3d/Interior3D";

export type LaunchSequenceMode = "intro" | "restart";

interface LaunchSequenceProps {
  mode: LaunchSequenceMode;
  assetState: InteriorAssetState;
  isMobile: boolean;
  onEnter: () => void;
  onRetry: () => void;
}

const INTRO_LINES = [
  "2008年3月初，深夜。紫金港的路灯在雾里发着模糊的光。",
  "你叫张超，计算机系大二。室友林伟硬拉着你，来到校区西南角的农医馆自习。",
  "馆里只剩稀稀拉拉的学生。暖气开着，窗户紧闭，四周只有翻书与写字声。",
  "林伟忽然停下笔，问你有没有听见一个女人在唱歌。你什么也没听见。",
  "23:47，借阅机吐出一张不存在的记录。归还地点：医学院地下仓库。",
  "小票背面还有一行浅字：湖边不要回头。",
];

const RESTART_LINES = [
  "你猛地睁开眼。",
  "时钟仍停在 23:47。",
  "借阅机又吐出同一张小票。",
  "你没有逃出去，只是重新回到了故事开头。",
];

const INTRO_MIN_DURATION = 8800;
const RESTART_MIN_DURATION = 2300;
const DISMISS_DURATION = 900;

export default function LaunchSequence({
  mode,
  assetState,
  isMobile,
  onEnter,
  onRetry,
}: LaunchSequenceProps): React.ReactElement {
  const [copyComplete, setCopyComplete] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);
  const lines = mode === "intro" ? INTRO_LINES : RESTART_LINES;
  const canEnter = copyComplete && assetState === "ready";

  useEffect(() => {
    const timer = window.setTimeout(
      () => setCopyComplete(true),
      mode === "intro" ? INTRO_MIN_DURATION : RESTART_MIN_DURATION,
    );
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(() => () => {
    if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
  }, []);

  const beginDismiss = useCallback(() => {
    if (!canEnter || dismissing) return;
    setDismissing(true);
    dismissTimerRef.current = window.setTimeout(onEnter, DISMISS_DURATION);
  }, [canEnter, dismissing, onEnter]);

  useEffect(() => {
    if (mode === "restart" && canEnter) beginDismiss();
  }, [beginDismiss, canEnter, mode]);

  const handleBackdropClick = useCallback(() => {
    if (mode === "intro") beginDismiss();
  }, [beginDismiss, mode]);

  const handleContinueClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    beginDismiss();
  }, [beginDismiss]);

  const handleRetryClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRetry();
  }, [onRetry]);

  const controls = isMobile
    ? "左侧摇杆移动 · 右侧拖动视角 · 点击按钮互动"
    : "点击画面锁定视角 · WASD/方向键移动 · Shift奔跑 · E互动";

  return (
    <section
      className={`launchSequence is-${mode}${canEnter ? " is-ready" : ""}${dismissing ? " is-dismissing" : ""}`}
      aria-label={mode === "intro" ? "游戏背景与玩法介绍" : "重新进入游戏"}
      aria-busy={assetState === "loading"}
      onClick={handleBackdropClick}
    >
      <div className="launchSequence__noise" aria-hidden="true" />
      <div className="launchSequence__copy" aria-live="polite">
        <p className="launchSequence__kicker">浙大夜惊魂 / 失落记录</p>
        <div className="launchSequence__story">
          {lines.map((line, index) => (
            <p
              className="launchSequence__line"
              data-text={line}
              key={line}
              style={{ "--launch-delay": `${0.4 + index * (mode === "intro" ? 0.56 : 0.3)}s` } as CSSProperties}
            >
              {line}
            </p>
          ))}
        </div>

        {mode === "intro" ? (
          <div className="launchSequence__tutorial">
            <p style={{ "--launch-delay": "3.65s" } as CSSProperties}>
              跟随红色指引，依次调查校园 8 个地点，收集关键道具与线索。
            </p>
            <p style={{ "--launch-delay": "4.25s" } as CSSProperties}>
              进入室内后，请跟随右上角小地图中的红点，寻找当前剧情点或道具。
            </p>
            <p style={{ "--launch-delay": "4.85s" } as CSSProperties}>
              红鬼贴身会造成致命伤害（护身符可抵挡一次）；理智降到 0 也会死亡。
            </p>
            <p style={{ "--launch-delay": "5.45s" } as CSSProperties}>
              每次离开室内，你有 5 秒安全时间拉开距离；随后红鬼会从远处沿道路追来。
            </p>
            <p style={{ "--launch-delay": "6.05s" } as CSSProperties}>
              守住理智，在小剧场阻止仪式并作出最终选择，才能通关。
            </p>
            <p className="launchSequence__controls" style={{ "--launch-delay": "6.65s" } as CSSProperties}>
              {controls}
            </p>
          </div>
        ) : null}
      </div>

      {copyComplete ? (
        <div className="launchSequence__footer" role="status">
          {assetState === "failed" ? (
            <>
              <p className="launchSequence__error">档案读取失败。精细场景没有回应。</p>
              <button type="button" onClick={handleRetryClick}>重新读取</button>
            </>
          ) : assetState === "ready" && mode === "intro" ? (
            <button className="launchSequence__continue" type="button" onClick={handleContinueClick}>
              点击任意位置继续
            </button>
          ) : (
            <p className="launchSequence__loading">
              {assetState === "ready" ? "轮回正在闭合……" : "正在读取失落记录……"}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
