import type { MutableRefObject } from "react";
import type { Interior3D } from "./Interior3D";
import {
  MEDICAL_GARAGE_DOCUMENT,
  MEDICAL_GARAGE_OPENING,
  type MedicalGarageModal,
  type MedicalGarageSnapshot,
} from "./medicalGarageData";

interface MedicalGarageExperienceProps {
  active: boolean;
  engineRef: MutableRefObject<Interior3D | null>;
  snapshot: MedicalGarageSnapshot | null;
  modal: MedicalGarageModal | null;
  onModalClosed: () => void;
}

export default function MedicalGarageExperience({
  active,
  engineRef,
  snapshot,
  modal,
  onModalClosed,
}: MedicalGarageExperienceProps): React.ReactElement | null {
  if (!active) return null;

  const close = (): void => {
    if (!modal) return;
    const kind = modal.kind;
    onModalClosed();
    engineRef.current?.completeMedicalGarageModal(kind);
    engineRef.current?.requestPointerLock();
  };

  const lines = modal?.kind === "document" ? MEDICAL_GARAGE_DOCUMENT : MEDICAL_GARAGE_OPENING;
  return (
    <>
      {snapshot && (
        <aside
          className="medicalGarageViolations"
          aria-label="地下车库惊吓次数"
          data-stage={snapshot.stage}
          data-activated-nodes={snapshot.activatedNodes}
        >
          <span>失守</span>
          <div>
            {[0, 1, 2].map((index) => (
              <b key={index} className={index < snapshot.violations ? "active" : undefined}>×</b>
            ))}
          </div>
        </aside>
      )}

      {snapshot?.loadingText && <div className="medicalGarageLoading">{snapshot.loadingText}</div>}
      {snapshot?.stage === "transition" && <div className="medicalGarageBlackout" aria-hidden="true" />}

      {modal && (
        <div className="storyGlassBackdrop strong medicalStoryBackdrop">
          <section
            className={`storyModal medicalStoryModal ${modal.kind === "document" ? "medicalGarageDocumentModal" : ""}`}
            aria-modal="true"
            role="dialog"
          >
            <div className="storyKicker">
              <span>{modal.kind === "document" ? "地下车库 · 第六柱" : "医学院 · 地下车库"}</span>
              <b>2008年3月8日　23:47</b>
            </div>
            <h1>{modal.kind === "document" ? "被雨水泡开的巡查记录" : "雷光里的亡魂"}</h1>
            <div className={`storyText ${modal.kind === "document" ? "medicalRecordBody" : ""}`}>
              {lines.map((line, index) => (
                <p
                  key={index}
                  className={
                    line.startsWith("不要把后背交给它") || line.startsWith("我以为唱歌的女人在追我")
                      ? "shock"
                      : index >= lines.length - 2
                        ? "tense"
                        : undefined
                  }
                >
                  {line}
                </p>
              ))}
            </div>
            <button type="button" onClick={close} className="choiceButton primary medicalStoryContinue">
              {modal.kind === "document" ? "记住最后一行" : "走进黑暗"}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
