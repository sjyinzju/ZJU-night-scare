import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { assetUrl } from "../assetPath";
import type { Interior3D } from "./Interior3D";
import {
  MEDICAL_601_OBSERVATIONS,
  MEDICAL_601_RECORD,
  MEDICAL_603_OBSERVATIONS,
  MEDICAL_603_LABELS,
  MEDICAL_605_ANOMALY,
  MEDICAL_605_CHOICES,
  MEDICAL_605_TRUTH,
  MEDICAL_TOP_RULES,
  type MedicalTopModal,
  type MedicalTopSnapshot,
} from "./medicalTopData";

interface MedicalTopExperienceProps {
  active: boolean;
  engineRef: MutableRefObject<Interior3D | null>;
  snapshot: MedicalTopSnapshot | null;
  modal: MedicalTopModal | null;
  onModalClosed: () => void;
}

const CCTV_NORMAL = ["normal-01.webp", "normal-02.webp", "normal-03.webp"];
const CCTV_PACK = {
  A: ["abnormal-a-01.webp", "abnormal-a-02.webp"],
  B: ["abnormal-b-01.webp", "abnormal-b-02.webp"],
} as const;

export default function MedicalTopExperience({
  active,
  engineRef,
  snapshot,
  modal,
  onModalClosed,
}: MedicalTopExperienceProps): React.ReactElement | null {
  const rulesScrollRef = useRef<HTMLDivElement>(null);
  const bottomTimerRef = useRef<number | null>(null);
  const [rulesCanClose, setRulesCanClose] = useState(false);
  const [cctvIndex, setCctvIndex] = useState(0);
  const [cctvFinished, setCctvFinished] = useState(false);

  useEffect(() => {
    setRulesCanClose(false);
    if (bottomTimerRef.current !== null) window.clearTimeout(bottomTimerRef.current);
    bottomTimerRef.current = null;
    if (modal?.kind !== "rules") return;
    window.requestAnimationFrame(() => {
      if (rulesScrollRef.current) rulesScrollRef.current.scrollTop = 0;
    });
    return () => {
      if (bottomTimerRef.current !== null) window.clearTimeout(bottomTimerRef.current);
      bottomTimerRef.current = null;
    };
  }, [modal]);

  useEffect(() => {
    if (modal?.kind !== "cctv") return;
    setCctvIndex(0);
    setCctvFinished(false);
    const timer = window.setInterval(() => {
      setCctvIndex((previous) => {
        if (previous >= 4) {
          window.clearInterval(timer);
          setCctvFinished(true);
          return previous;
        }
        return previous + 1;
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [modal]);

  const finishRules = useCallback(() => {
    if (!rulesCanClose) return;
    onModalClosed();
    engineRef.current?.completeMedicalTopRules();
    engineRef.current?.requestPointerLock();
  }, [engineRef, onModalClosed, rulesCanClose]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (modal.kind === "rules" && rulesCanClose && event.key === "Escape") {
        event.preventDefault();
        finishRules();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [finishRules, modal, rulesCanClose]);

  if (!active) return null;

  const handleRulesScroll = (): void => {
    const node = rulesScrollRef.current;
    if (!node || rulesCanClose || bottomTimerRef.current !== null) return;
    const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 5;
    if (!atBottom) return;
    bottomTimerRef.current = window.setTimeout(() => {
      bottomTimerRef.current = null;
      setRulesCanClose(true);
    }, 3000);
  };

  const closeDocument = (kind: "record" | "skull"): void => {
    onModalClosed();
    engineRef.current?.completeMedicalTopDocument(kind);
    engineRef.current?.requestPointerLock();
  };

  const chooseEvidence = (evidence: string): void => {
    onModalClosed();
    engineRef.current?.completeMedicalTopCctv(evidence);
    engineRef.current?.requestPointerLock();
  };

  const cctvImages = modal?.kind === "cctv"
    ? [...CCTV_NORMAL, ...CCTV_PACK[modal.pack]].map((file) => assetUrl(`images/medical-cctv/${file}`, "medical-cctv-v2-webp"))
    : [];

  return (
    <>
      {snapshot && (
        <aside style={styles.violationRail} aria-label="规则违规次数">
          <span style={styles.violationLabel}>违规</span>
          <div style={styles.violationCrosses}>
            {[0, 1, 2].map((index) => (
              <b key={index} style={{ ...styles.violationCross, ...(index < snapshot.violations ? styles.violationCrossActive : undefined) }}>×</b>
            ))}
          </div>
        </aside>
      )}

      {snapshot?.loadingText && <div style={styles.loadingText}>{snapshot.loadingText}</div>}
      {snapshot?.stage === "transition" && <div style={styles.transitionBlackout} aria-hidden="true" />}

      {modal?.kind === "rules" && (
        <div className="storyGlassBackdrop strong medicalStoryBackdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget && rulesCanClose) finishRules();
        }}>
          <section className="storyModal medicalStoryModal medicalRulesModal" aria-modal="true" role="dialog" aria-label="医学院六层夜间巡查守则">
            <div className="storyKicker"><span>医学院 · 六层</span><b>修订时间：今晚 23:47</b></div>
            <h1>夜间巡查守则</h1>
            <div ref={rulesScrollRef} onScroll={handleRulesScroll} className="storyText medicalRulesScroll">
              {MEDICAL_TOP_RULES.map((rule, index) => (
                <p key={index} className="medicalRule" style={{ "--story-line-delay": `${Math.min(index * 24, 360)}ms` } as CSSProperties}>
                  <b className="medicalRuleNumber">{index + 1}.</b>
                  <span className="medicalRuleLines">
                    {rule.lines.map((line, lineIndex) => (
                      <span key={lineIndex} className={`medicalRuleLine medicalRuleLine--${line.tone ?? "normal"}`}>{line.text}</span>
                    ))}
                  </span>
                </p>
              ))}
              <p className="medicalRulesBottomMark shock">—— 规则到此为止。请不要继续向下看。——</p>
            </div>
            {rulesCanClose && (
              <button type="button" onClick={finishRules} className="choiceButton primary medicalStoryContinue">
                我已阅读
              </button>
            )}
          </section>
        </div>
      )}

      {modal?.kind === "record" && (
        <div className="storyGlassBackdrop strong medicalStoryBackdrop">
          <section className="storyModal medicalStoryModal" aria-modal="true" role="dialog" aria-label="六层夜间巡查记录">
            <div className="storyKicker"><span>601 · 值班室</span><b>23:47</b></div>
            <h1>六层夜间巡查记录</h1>
            <div className="storyText medicalRecordBody">
              {MEDICAL_601_RECORD.map((line, index) => (
                line === "六层夜间巡查记录" ? null : (
                  <p key={index} className={line === "林伟" ? "shock medicalBleedingName" : undefined}>{line || "\u00a0"}</p>
                )
              ))}
              {modal.revisit && <p className="shock medicalBleedingName">第二次复核人：正在阅读这行的人。</p>}
              {MEDICAL_601_OBSERVATIONS.map((line, index) => <p key={`observation-${index}`} className="tense">{line}</p>)}
            </div>
            <button type="button" onClick={() => closeDocument("record")} className="choiceButton primary medicalStoryContinue">合上记录</button>
          </section>
        </div>
      )}

      {modal?.kind === "skull" && (
        <div className="storyGlassBackdrop strong medicalStoryBackdrop">
          <section className="storyModal medicalStoryModal" aria-modal="true" role="dialog" aria-label="颅骨标签">
            <div className="storyKicker"><span>603 · 教学标本</span><b>入库标签</b></div>
            <h1>{modal.abnormal ? "这个编号不属于这里" : "教学标本记录"}</h1>
            <div className="storyText">
              <p className={modal.abnormal ? "shock medicalSpecimenCode" : "medicalSpecimenCode"}>
                {modal.abnormal ? MEDICAL_603_LABELS.abnormal : MEDICAL_603_LABELS.normal}
              </p>
              {MEDICAL_603_OBSERVATIONS[modal.abnormal ? "abnormal" : "normal"].map((line, index) => (
                <p key={index} className={modal.abnormal && index > 0 ? "tense" : undefined}>{line}</p>
              ))}
            </div>
            <button type="button" onClick={() => closeDocument("skull")} className="choiceButton primary medicalStoryContinue">放回标签</button>
          </section>
        </div>
      )}

      {modal?.kind === "cctv" && (
        <div style={styles.cctvBackdrop}>
          {!cctvFinished ? (
            <div style={styles.cctvFrame}>
              <img src={cctvImages[cctvIndex]} alt={`六层监控录像 ${cctvIndex + 1}/5`} style={styles.cctvImage} />
              <div style={styles.cctvNoise} />
              <div style={styles.timecode}>CAM 06　23:47:{String(12 + cctvIndex * 2).padStart(2, "0")}　REC</div>
              <div style={styles.frameCount}>{cctvIndex + 1} / 5</div>
            </div>
          ) : (
            <section className="storyModal medicalStoryModal medicalCctvTruth">
              <div className="storyKicker"><span>605 · 录像结束</span><b>CAM 06</b></div>
              <h1>缺失的七秒</h1>
              <div className="storyText">
                <p className="shock">{MEDICAL_605_ANOMALY[modal.pack]}</p>
                <p>{MEDICAL_605_TRUTH}</p>
                <p className="tense">画面停住了，但放映机仍在转。桌面下方传来一声很轻的电梯提示音。</p>
              </div>
              <div className="choiceList medicalCctvChoices">
                {MEDICAL_605_CHOICES[modal.pack].map((choice) => (
                  <button key={choice.id} type="button" className="choiceButton" onClick={() => chooseEvidence(choice.evidence)}>
                    <strong>{choice.label}</strong>
                    <span>{choice.evidence}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

const FONT = 'Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
const styles: Record<string, CSSProperties> = {
  violationRail: { position: "absolute", right: 326, top: 18, zIndex: 24, minWidth: 116, padding: "10px 13px", border: "1px solid rgba(139,25,38,.55)", borderRadius: 10, background: "rgba(5,6,9,.82)", color: "#c9bca9", fontFamily: FONT, backdropFilter: "blur(8px)" },
  violationLabel: { display: "block", fontSize: 11, letterSpacing: ".28em", color: "#806f67", marginBottom: 2 },
  violationCrosses: { display: "flex", gap: 8, lineHeight: 1 },
  violationCross: { fontSize: 27, fontWeight: 400, color: "#51484a", textShadow: "none" },
  violationCrossActive: { color: "#e4142c", textShadow: "0 0 12px rgba(255,0,30,.8)" },
  loadingText: { position: "absolute", left: "50%", bottom: "18%", transform: "translateX(-50%)", zIndex: 40, color: "#bb2030", letterSpacing: ".18em", animation: "interiorLoadingPulse 1.1s steps(2,end) infinite", textShadow: "0 0 15px #66000b" },
  transitionBlackout: { position: "fixed", inset: 0, zIndex: 100, background: "#000", animation: "medicalBlackout .45s ease-in both" },
  cctvBackdrop: { position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", background: "#010203", fontFamily: FONT },
  cctvFrame: { position: "relative", width: "min(1180px, 100vw)", aspectRatio: "16 / 9", overflow: "hidden", background: "#020605", boxShadow: "0 0 0 1px #26302d, 0 0 120px rgba(44,85,75,.22)" },
  cctvImage: { width: "100%", height: "100%", objectFit: "cover", filter: "saturate(.32) contrast(1.26) brightness(.73) sepia(.18)" },
  cctvNoise: { position: "absolute", inset: 0, pointerEvents: "none", opacity: .5, background: "repeating-linear-gradient(0deg, transparent 0 2px, rgba(195,230,215,.11) 3px, transparent 4px), radial-gradient(circle at 50% 50%, transparent 30%, rgba(0,0,0,.7) 100%)", animation: "medicalCctvRoll .18s steps(2,end) infinite" },
  timecode: { position: "absolute", left: 22, bottom: 18, color: "#d8e8d9", fontFamily: "monospace", fontSize: 17, textShadow: "0 0 6px #000" },
  frameCount: { position: "absolute", right: 22, top: 18, color: "#a7b9aa", fontFamily: "monospace" },
};
