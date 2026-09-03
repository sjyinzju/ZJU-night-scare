import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { assetUrl } from "../assetPath";
import { audioManager } from "../audio/audioManager";
import { JumpscarePipeline } from "../JumpscarePipeline";
import type { Interior3D } from "./Interior3D";
import {
  MEDICAL_BASEMENT_CLUTTER_INTRO,
  MEDICAL_BASEMENT_CONCLUSIONS,
  MEDICAL_BASEMENT_INVESTIGATIONS,
  MEDICAL_BASEMENT_NOTEBOOK_PAGES,
  type MedicalBasementConclusionId,
  type MedicalBasementEvidenceId,
  type MedicalBasementModal,
  type MedicalBasementSnapshot,
} from "./medicalBasementData";

interface MedicalBasementExperienceProps {
  active: boolean;
  engineRef: MutableRefObject<Interior3D | null>;
  snapshot: MedicalBasementSnapshot | null;
  modal: MedicalBasementModal | null;
  onModalClosed: () => void;
}

const BASEMENT_IMAGE_VERSION = "medical-basement-v2";
const EVIDENCE_IDS: MedicalBasementEvidenceId[] = ["registry", "rope", "protocol"];
const ARCHIVE_PAGE_COUNT = MEDICAL_BASEMENT_NOTEBOOK_PAGES.length;

function archiveImageUrl(file: string): string {
  return assetUrl(`images/medical-basement/${file}`, BASEMENT_IMAGE_VERSION);
}

export default function MedicalBasementExperience({
  active,
  engineRef,
  snapshot,
  modal,
  onModalClosed,
}: MedicalBasementExperienceProps): ReactElement | null {
  const [evidenceIds, setEvidenceIds] = useState<MedicalBasementEvidenceId[]>([]);
  const [activeEvidence, setActiveEvidence] = useState<MedicalBasementEvidenceId | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [conclusionId, setConclusionId] = useState<MedicalBasementConclusionId | null>(null);
  const [password, setPassword] = useState("");
  const [passwordLocked, setPasswordLocked] = useState(false);
  const bloodCanvasRef = useRef<HTMLCanvasElement>(null);
  const bloodPointerRef = useRef<number | null>(null);

  const turnToPage = useCallback((nextPage: number): void => {
    const normalized = Math.max(0, Math.min(ARCHIVE_PAGE_COUNT - 2, nextPage - (nextPage % 2)));
    setPageIndex((current) => {
      if (current === normalized) return current;
      audioManager.playPageTurn();
      return normalized;
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const files = [
      "suwan-door-v1.png",
      "archive-intake-v1.png",
      "archive-anomaly-v1.png",
      "archive-blood-stain-v1.png",
      "archive-notebook-spread-v1.png",
    ];
    const images = files.map((file) => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "high";
      image.src = archiveImageUrl(file);
      return image;
    });
    return () => images.forEach((image) => { image.src = ""; });
  }, [active]);

  useEffect(() => {
    if (modal?.kind === "clutter") {
      setEvidenceIds([]);
      setActiveEvidence(null);
    } else if (modal?.kind === "notebook") {
      setPageIndex(0);
      setConclusionId(null);
    } else if (modal?.kind === "password") {
      setPassword("");
      setPasswordLocked(false);
    }
  }, [modal]);

  useEffect(() => {
    if (modal?.kind !== "notebook" || pageIndex !== 2) return;
    const canvas = bloodCanvasRef.current;
    if (!canvas) return;
    const stain = new Image();
    let cancelled = false;
    stain.decoding = "async";
    stain.src = archiveImageUrl("archive-blood-stain-v1.png");
    const drawStain = (): void => {
      if (cancelled) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.drawImage(stain, 0, 0, rect.width, rect.height);
    };
    stain.addEventListener("load", drawStain, { once: true });
    return () => {
      cancelled = true;
      stain.removeEventListener("load", drawStain);
      stain.src = "";
    };
  }, [modal, pageIndex]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (modal.kind === "notebook") {
        if ((event.key === "ArrowLeft" || event.key.toLowerCase() === "a") && pageIndex > 0) {
          turnToPage(pageIndex - 2);
        } else if ((event.key === "ArrowRight" || event.key.toLowerCase() === "d")
          && pageIndex < ARCHIVE_PAGE_COUNT - 2) {
          turnToPage(pageIndex + 2);
        }
      }
      event.stopImmediatePropagation();
      if (modal.kind !== "password") event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [modal, pageIndex, turnToPage]);

  const eraseBloodAt = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (bloodPointerRef.current !== event.pointerId) return;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / Math.max(1, rect.width);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.globalCompositeOperation = "destination-out";
    const radius = Math.max(24, rect.width * .055);
    const gradient = context.createRadialGradient(x, y, radius * .25, x, y, radius);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();

  }, []);

  const chooseEvidence = (id: MedicalBasementEvidenceId): void => {
    audioManager.playChoice();
    setEvidenceIds((current) => current.includes(id) ? current : [...current, id]);
    setActiveEvidence(id);
  };

  const finishClutter = (): void => {
    if (evidenceIds.length < 2) return;
    audioManager.playChoice();
    onModalClosed();
    engineRef.current?.completeMedicalBasementClutter(evidenceIds);
    engineRef.current?.requestPointerLock();
  };

  const finishNotebook = (): void => {
    if (!conclusionId) return;
    audioManager.playChoice();
    onModalClosed();
    engineRef.current?.completeMedicalBasementNotebook(conclusionId);
    engineRef.current?.requestPointerLock();
  };

  const submitPassword = (event: FormEvent): void => {
    event.preventDefault();
    if (passwordLocked || password.length !== 4) return;
    if (password === "2347") {
      audioManager.playChoice();
      onModalClosed();
      engineRef.current?.submitMedicalBasementPassword(password);
      return;
    }
    setPasswordLocked(true);
    setPassword("");
    engineRef.current?.submitMedicalBasementPassword(password);
    JumpscarePipeline.executeStoryEffect("ghost_caught", 1, "交接时间不成立", "medical-basement", 0);
    window.setTimeout(() => setPasswordLocked(false), 1450);
  };

  if (!active) return null;
  const activeInvestigation = activeEvidence ? MEDICAL_BASEMENT_INVESTIGATIONS[activeEvidence] : null;
  const selectedConclusion = conclusionId
    ? MEDICAL_BASEMENT_CONCLUSIONS.find((choice) => choice.id === conclusionId)
    : undefined;

  return (
    <>
      {snapshot?.loadingText ? <div className="medicalGarageLoading">{snapshot.loadingText}</div> : null}
      {snapshot?.stage === "transition" ? <div className="medicalGarageBlackout" aria-hidden="true" /> : null}

      {modal?.kind === "clutter" ? (
        <div className="storyGlassBackdrop strong medicalStoryBackdrop">
          <section className="storyModal medicalStoryModal medicalBasementClutter" aria-modal="true" role="dialog">
            <div className="storyKicker"><span>地下仓库 · 杂物间</span><b>2008年3月8日　23:47</b></div>
            <h1>{activeInvestigation?.title ?? "没有登记的羽毛"}</h1>
            <div className="storyText medicalBasementScrollableText">
              {(activeInvestigation?.lines ?? MEDICAL_BASEMENT_CLUTTER_INTRO).map((line, index) => (
                <p key={index} className={line.includes("下一名记录者") ? "shock" : index >= 5 ? "tense" : undefined}>{line}</p>
              ))}
            </div>
            {activeInvestigation ? (
              <button type="button" className="choiceButton primary medicalStoryContinue" onClick={() => {
                audioManager.playChoice();
                setActiveEvidence(null);
              }}>
                返回设备间继续调查
              </button>
            ) : (
              <>
                <div className="choiceList medicalBasementChoices">
                  {EVIDENCE_IDS.map((id) => (
                    <button key={id} type="button" className="choiceButton" onClick={() => chooseEvidence(id)}>
                      <strong>{MEDICAL_BASEMENT_INVESTIGATIONS[id].label}</strong>
                      {evidenceIds.includes(id) ? <small>已记录</small> : null}
                    </button>
                  ))}
                </div>
                {evidenceIds.length >= 2 ? (
                  <button type="button" className="choiceButton primary medicalStoryContinue" onClick={finishClutter}>
                    带着羽毛进入解剖室
                  </button>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}

      {modal?.kind === "notebook" ? (
        <div className="storyGlassBackdrop strong medicalStoryBackdrop medicalNotebookBackdrop">
          <section className="medicalNotebook" aria-modal="true" role="dialog" aria-label="R-1953特殊病例档案">
            <img
              className="medicalNotebook__paperTexture"
              src={archiveImageUrl("archive-notebook-spread-v1.png")}
              alt=""
              aria-hidden="true"
            />
            <div className="medicalNotebook__binding" aria-hidden="true" />
            <div className="medicalNotebook__spread">
              {MEDICAL_BASEMENT_NOTEBOOK_PAGES.slice(pageIndex, pageIndex + 2).map((archivePage, visibleIndex) => (
                <article
                  key={archivePage.id}
                  className={`medicalNotebook__folio ${"image" in archivePage ? "medicalNotebook__folio--photo" : ""}`}
                  aria-label={`档案第${pageIndex + visibleIndex + 1}页`}
                >
                  <span className="medicalNotebook__pageKicker">{archivePage.kicker}</span>
                  <h1>{archivePage.title}</h1>
                  <div className="medicalNotebook__folioBody">
                    {"image" in archivePage ? (
                      <figure className="medicalNotebook__photoFrame">
                        <img src={archiveImageUrl(archivePage.image)} alt={archivePage.imageAlt} className="medicalNotebook__photo" />
                        <figcaption>原件照片 · 禁止复制</figcaption>
                      </figure>
                    ) : null}
                    <div className={`medicalNotebook__copy ${archivePage.id === "photo-anomaly" ? "medicalNotebook__copy--contaminated" : ""}`}>
                      {(archivePage.id === "maintenance" && selectedConclusion
                        ? archivePage.lines.slice(0, 3)
                        : archivePage.lines).map((line, index) => (
                        <p key={index} className={
                          (archivePage.id === "maintenance" && index >= 5)
                            || (archivePage.id === "photo-anomaly" && index >= 2)
                            || (archivePage.id === "blood" && index >= 4)
                            ? "shock"
                            : undefined
                        }>{line}</p>
                      ))}
                      {archivePage.id === "blood" ? (
                        <p className="medicalNotebook__futureInk">擦除人：张超　2008年3月8日　23:47</p>
                      ) : null}
                    </div>
                  </div>
                  {archivePage.id === "blood" ? (
                    <>
                      <canvas
                        ref={bloodCanvasRef}
                        className="medicalNotebook__blood"
                        onPointerDown={(event) => {
                          bloodPointerRef.current = event.pointerId;
                          event.currentTarget.setPointerCapture(event.pointerId);
                          eraseBloodAt(event);
                        }}
                        onPointerMove={eraseBloodAt}
                        onPointerUp={() => { bloodPointerRef.current = null; }}
                        onPointerCancel={() => { bloodPointerRef.current = null; }}
                      />
                      <div className="medicalNotebook__wipeHint">按住鼠标擦拭血迹；看清后自行翻页</div>
                    </>
                  ) : null}
                  {archivePage.id === "maintenance" ? (
                    <div className="medicalNotebook__conclusions">
                      {!selectedConclusion ? MEDICAL_BASEMENT_CONCLUSIONS.filter((choice) => (
                        !choice.requiresAllEvidence || evidenceIds.length === 3 || (snapshot?.evidenceIds.length ?? 0) === 3
                      )).map((choice) => (
                        <button key={choice.id} type="button" className="choiceButton" onClick={() => {
                          audioManager.playChoice();
                          setConclusionId(choice.id);
                        }}>
                          {choice.label}
                        </button>
                      )) : (
                        <div className="medicalNotebook__conclusionResult">
                          {selectedConclusion.outcome.map((line, index) => <p key={index}>{line}</p>)}
                          <button type="button" className="choiceButton primary" onClick={finishNotebook}>合上档案并带走照片</button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <button
              type="button"
              className="medicalNotebook__nav medicalNotebook__nav--previous"
              disabled={pageIndex === 0}
              onClick={() => turnToPage(pageIndex - 2)}
            >‹</button>
            <button
              type="button"
              className="medicalNotebook__nav medicalNotebook__nav--next"
              disabled={pageIndex >= ARCHIVE_PAGE_COUNT - 2}
              onClick={() => turnToPage(pageIndex + 2)}
            >›</button>
            <span className="medicalNotebook__counter">{pageIndex + 1}–{Math.min(pageIndex + 2, ARCHIVE_PAGE_COUNT)} / {ARCHIVE_PAGE_COUNT}</span>
          </section>
        </div>
      ) : null}

      {modal?.kind === "password" ? (
        <div className="storyGlassBackdrop strong medicalStoryBackdrop">
          <section className="storyModal medicalStoryModal medicalBasementPassword" aria-modal="true" role="dialog">
            <div className="storyKicker"><span>地下解剖室 · 夜间交接</span><b>门只承认那一分钟</b></div>
            <h1>请输入四位交接记录</h1>
            <div className="medicalBasementClock" aria-hidden="true"><i /><b>:</b><i /></div>
            <form onSubmit={submitPassword}>
              <input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={password}
                disabled={passwordLocked}
                aria-label="四位交接记录"
                onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              <button type="submit" className="choiceButton primary" disabled={passwordLocked || password.length !== 4}>确认交接</button>
            </form>
            {(snapshot?.wrongPasswordAttempts ?? 0) >= 3 ? <p className="shock medicalBasementPassword__hint">停钟数值</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
