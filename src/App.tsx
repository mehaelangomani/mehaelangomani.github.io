import { useEffect, useRef, useState } from 'react';
import { AxonParticleScene } from './webgl/AxonParticleScene';
import { initVanteRibbonScene, type RibbonDomRefs } from './ribbon/ribbonScene';

const DEV_SKILLS = ['HTML', 'CSS', 'JavaScript', 'Python', 'C', 'React', 'TypeScript'];
const AI_SKILLS = ['Machine Learning', 'Natural Language Processing', 'AI Applications', 'Model Integration'];
const DATA_SKILLS = ['SQL', 'MySQL', 'Supabase', 'Data Analysis'];
const ALGO_SKILLS = ['Data Structures', 'Algorithms', 'Optimization', 'Problem Solving'];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (start: number, end: number, value: number) => {
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};

export default function App() {
  const introTrackRef = useRef<HTMLElement | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particleSceneRef = useRef<AxonParticleScene | null>(null);
  const ribbonTrackRef = useRef<HTMLDivElement | null>(null);
  const ribbonStageRef = useRef<HTMLElement | null>(null);
  const ribbonCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const l1Ref = useRef<HTMLDivElement | null>(null);
  const l2Ref = useRef<HTMLDivElement | null>(null);
  const capRef = useRef<HTMLDivElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const crossRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const ruleRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLDivElement | null>(null);
  const [introProgress, setIntroProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resumeNotice, setResumeNotice] = useState(false);

  // Existing particle scene: its progress is derived from native document scrolling.
  useEffect(() => {
    const canvas = particleCanvasRef.current;
    const track = introTrackRef.current;
    if (!canvas || !track) return;

    const engine = new AxonParticleScene(canvas, { onError: (error) => console.error('[Portfolio particle scene]', error) });
    particleSceneRef.current = engine;

    const update = () => {
      const rect = track.getBoundingClientRect();
      const range = Math.max(1, track.offsetHeight - window.innerHeight);
      const p = clamp01(-rect.top / range);
      engine.setScrollProgress(p);
      setIntroProgress(p);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      engine.dispose();
      particleSceneRef.current = null;
    };
  }, []);

  // Independent ribbon scene. It reads progress relative to its own 900vh track.
  useEffect(() => {
    const track = ribbonTrackRef.current;
    const stage = ribbonStageRef.current;
    const canvas = ribbonCanvasRef.current;
    const l1 = l1Ref.current;
    const l2 = l2Ref.current;
    const cap = capRef.current;
    const hint = hintRef.current;
    const pager = pagerRef.current;
    const cross = crossRef.current;
    const glow = glowRef.current;
    const rule = ruleRef.current;
    const name = nameRef.current;
    if (!track || !stage || !canvas || !l1 || !l2 || !cap || !hint || !pager || !cross || !glow || !rule || !name) return;

    const refs: RibbonDomRefs = { track, stage, canvas, l1, l2, cap, hint, pager, cross, glow, rule, name };
    return initVanteRibbonScene(refs);
  }, []);

  const mehaRise = smooth(0.05, 0.2, introProgress);
  const mehaFall = 1 - smooth(0.4, 0.55, introProgress);
  const mehaOpacity = mehaRise * mehaFall;
  const taglineRise = smooth(0.15, 0.3, introProgress);
  const taglineOpacity = taglineRise * mehaFall;
  const technicalOpacity = smooth(0.5, 0.7, introProgress);
  const centered = (opacity: number) => `translate(-50%, -50%) translateY(${20 * (1 - opacity)}px)`;
  const particleOpacity = 1 - smooth(0.91, 1, introProgress);

  const goTo = (id: string) => {
    setMenuOpen(false);
    if (id === 'technical-identity-anchor' && introTrackRef.current) {
      const track = introTrackRef.current;
      const range = Math.max(1, track.offsetHeight - window.innerHeight);
      window.scrollTo({ top: track.offsetTop + range * 0.88, behavior: 'smooth' });
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <main className="portfolio-shell">
      <canvas id="bg" ref={particleCanvasRef} aria-hidden="true" style={{ opacity: particleOpacity }} />

      <section className="intro-track" id="introduction" ref={introTrackRef}>
        <div className="intro-stage">
          <div className="scroll-overlay">
            <div className="scroll-intro" style={{ opacity: mehaOpacity, transform: centered(mehaOpacity) }}>
              <h1 className="scroll-title">MEHA</h1>
              <p className="scroll-tagline" style={{ opacity: taglineOpacity, transform: `translateY(${20 * (1 - taglineOpacity)}px)` }}>
                Turning curiosity into meaningful technology
              </p>
            </div>
            <div className="scroll-technical" id="technical-identity-anchor" style={{ opacity: technicalOpacity, transform: centered(technicalOpacity) }}>
              <h1 className="scroll-title">TECHNICAL IDENTITY</h1>
              <div className="tech-grid">
                <SkillPanel number="01" title="DEVELOPMENT" skills={DEV_SKILLS} />
                <SkillPanel number="02" title="AI & MACHINE LEARNING" skills={AI_SKILLS} />
                <SkillPanel number="03" title="DATA" skills={DATA_SKILLS} />
                <SkillPanel number="04" title="ALGORITHMS & PROBLEM SOLVING" skills={ALGO_SKILLS} />
              </div>
            </div>
            <div className="intro-scroll-hint" style={{ opacity: 1 - smooth(0.02, 0.12, introProgress) }}>SCROLL TO EXPLORE</div>
          </div>
        </div>
      </section>

      <section className="selected-work" id="selected-work" aria-label="Selected work">
        <div id="track" ref={ribbonTrackRef}>
          <div className="stage ribbon-stage" id="stage" ref={ribbonStageRef}>
            <h2 className="ribbon-headline" aria-label="Craft in motion">
              <div className="hl" id="l1" ref={l1Ref} aria-hidden="true"><span>CRAFT IN</span></div>
              <div className="hl" id="l2" ref={l2Ref} aria-hidden="true"><span>MOTION</span></div>
            </h2>
            <div id="cap" ref={capRef}>A selection of projects, experiments and things in motion.</div>
            <div id="glow" ref={glowRef} />
            <div id="cross" ref={crossRef}><i>+</i></div>
            <div id="rule" ref={ruleRef} />
            <canvas id="gl" ref={ribbonCanvasRef} />
            <div id="hint" ref={hintRef}>SCROLL TO EXPLORE</div>
            <div id="pager" ref={pagerRef}><span>01</span><span>06</span></div>
            <header className="ribbon-top">
              <div className="section-label">MEHA <span>/</span> SELECTED WORK</div>
              <nav className="portfolio-actions" aria-label="Portfolio actions">
                <button type="button" onClick={() => setMenuOpen(true)}>MENU <b className="menu-glyph"><i /><i /></b></button>
                <button type="button" onClick={() => setResumeNotice(true)}>RESUME <span className="external-glyph">↗</span></button>
              </nav>
            </header>
            <footer className="ribbon-bottom">
              <p>Selected projects and experiments.</p>
              <div className="ribbon-bottom-center">DESIGN <s>/</s> DEVELOPMENT <s>/</s> EXPERIMENTS</div>
              <div className="ribbon-bottom-right">SCROLL TO EXPLORE <span>↓</span></div>
            </footer>
            <div id="name" ref={nameRef} />
            <div className="gallery-end-label">SELECTED WORK</div>
          </div>
        </div>
      </section>

      {menuOpen && (
        <div className="menu-overlay" role="dialog" aria-modal="true" aria-label="Portfolio menu">
          <button className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">CLOSE ×</button>
          <nav>
            <button onClick={() => goTo('introduction')}>INTRODUCTION <span>01</span></button>
            <button onClick={() => goTo('technical-identity-anchor')}>TECHNICAL IDENTITY <span>02</span></button>
            <button onClick={() => goTo('selected-work')}>SELECTED WORK <span>03</span></button>
          </nav>
        </div>
      )}
      {resumeNotice && (
        <div className="resume-notice" role="dialog" aria-modal="true" aria-label="Resume unavailable">
          <div className="resume-notice-card">
            <button className="resume-close" onClick={() => setResumeNotice(false)} aria-label="Close">×</button>
            <p>RESUME</p>
            <h2>Resume PDF not provided yet.</h2>
            <span>Add your resume PDF to the public folder as <code>resume.pdf</code> to activate this link.</span>
          </div>
        </div>
      )}
    </main>
  );
}

function SkillPanel({ number, title, skills }: { number: string; title: string; skills: string[] }) {
  return (
    <div className="tech-panel">
      <div className="panel-number">{number}</div>
      <h3 className="panel-title">{title}</h3>
      <ul className="tech-list">{skills.map((skill) => <li key={skill}>{skill}</li>)}</ul>
    </div>
  );
}
