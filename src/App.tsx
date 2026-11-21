import { useEffect, useRef, useState } from 'react';
import { AxonParticleScene } from './webgl/AxonParticleScene';

const DEV_SKILLS = [
  'HTML',
  'CSS',
  'JavaScript',
  'Python',
  'C',
  'React',
  'TypeScript',
];

const AI_SKILLS = [
  'Machine Learning',
  'Natural Language Processing',
  'AI Applications',
  'Model Integration',
];

const DATA_SKILLS = [
  'SQL',
  'MySQL',
  'Supabase',
  'Data Analysis',
];

const ALGO_SKILLS = [
  'Data Structures',
  'Algorithms',
  'Optimization',
  'Problem Solving',
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<AxonParticleScene | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new AxonParticleScene(canvas, {
      onError: () => {},
    });
    sceneRef.current = engine;

    let accumulated = 0;

    const applyProgress = (delta: number) => {
      accumulated = Math.min(1, Math.max(0, accumulated + delta));
      setProgress(accumulated);
      engine.setScrollProgress(accumulated);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Normalize wheel input so a single trackpad/mouse burst cannot skip an entire section.
      const normalizedDelta = Math.max(-80, Math.min(80, e.deltaY));
      applyProgress(normalizedDelta * 0.00045);
    };

    let lastTouchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const deltaY = lastTouchY - e.touches[0].clientY;
      lastTouchY = e.touches[0].clientY;
      applyProgress(Math.max(-80, Math.min(80, deltaY)) * 0.00045);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      engine.dispose();
    };
  }, []);

  // Three deliberate scroll states: particle-only → MEHA → Technical Identity.
  // Wide ranges prevent high-resolution trackpads from skipping the introduction.
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const smooth = (start: number, end: number, value: number) => {
    const t = clamp01((value - start) / (end - start));
    return t * t * (3 - 2 * t);
  };

  const mehaRise = smooth(0.12, 0.27, progress);
  const mehaFall = 1 - smooth(0.64, 0.79, progress);
  const mehaOpacity = mehaRise * mehaFall;

  const taglineRise = smooth(0.24, 0.39, progress);
  const taglineFall = 1 - smooth(0.64, 0.79, progress);
  const taglineOpacity = taglineRise * taglineFall;

  const technicalOpacity = smooth(0.78, 0.96, progress);

  // Keep the centering transform: inline transforms otherwise override the CSS
  // translate(-50%, -50%) and push the whole section below the viewport.
  const centeredTranslate = (opacity: number) =>
    `translate(-50%, -50%) translateY(${20 * (1 - opacity)}px)`;
  const mehaTranslate = centeredTranslate(mehaOpacity);
  const taglineTranslate = `translateY(${20 * (1 - taglineOpacity)}px)`;
  const technicalTranslate = centeredTranslate(technicalOpacity);

  return (
    <>
      <canvas id="bg" ref={canvasRef} aria-hidden="true" />

      <div className="scroll-overlay">
        <div className="scroll-intro" style={{ opacity: mehaOpacity, transform: mehaTranslate }}>
          <h1 className="scroll-title">MEHA</h1>
          <p className="scroll-tagline">Turning curiosity into meaningful technology</p>
        </div>

        <div className="scroll-technical" style={{ opacity: technicalOpacity, transform: technicalTranslate }}>
          <h1 className="scroll-title">TECHNICAL IDENTITY</h1>
          <div className="tech-grid">
            <div className="tech-panel">
              <div className="panel-number">01</div>
              <h2 className="panel-title">DEVELOPMENT</h2>
              <ul className="tech-list">
                {DEV_SKILLS.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </div>
            <div className="tech-panel">
              <div className="panel-number">02</div>
              <h2 className="panel-title">AI &amp; MACHINE LEARNING</h2>
              <ul className="tech-list">
                {AI_SKILLS.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </div>
            <div className="tech-panel">
              <div className="panel-number">03</div>
              <h2 className="panel-title">DATA</h2>
              <ul className="tech-list">
                {DATA_SKILLS.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </div>
            <div className="tech-panel">
              <div className="panel-number">04</div>
              <h2 className="panel-title">ALGORITHMS &amp; PROBLEM SOLVING</h2>
              <ul className="tech-list">
                {ALGO_SKILLS.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
