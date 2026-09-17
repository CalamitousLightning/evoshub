// XERA — shared ambient space + rotating cinematic background layer.
// Decorative only: no application state, API, mining, wallet or blockchain behavior.
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isXera = /(^|\/)xera(?:\/|$)/.test(window.location.pathname);
  if (!isXera) return;

  const bgPaths = [
    '/assets/images/xera-backgrounds/xera-cosmic-network.jpg',
    '/assets/images/xera-backgrounds/xera-global-grid.jpg',
    '/assets/images/xera-backgrounds/xera-future-city.jpg',
    '/assets/images/xera-backgrounds/xera-data-center.jpg',
    '/assets/images/xera-backgrounds/xera-digital-mining.jpg',
    '/assets/images/xera-backgrounds/xera-ai-core.jpg',
    '/assets/images/xera-backgrounds/xera-connected-world.jpg',
    '/assets/images/xera-backgrounds/xera-blockchain.jpg',
    '/assets/images/xera-backgrounds/xera-evolution-horizon.jpg'
  ];

  // Shared background layer works on both the public XERA pages and /xera app.
  const layer = document.createElement('div');
  layer.className = 'xera-scene-bg';
  layer.setAttribute('aria-hidden', 'true');

  const scenes = bgPaths.map((src, i) => {
    const scene = document.createElement('div');
    scene.className = 'xera-scene';
    scene.dataset.scene = String(i);
    scene.style.backgroundImage = `url("${src}")`;
    layer.appendChild(scene);
    return scene;
  });
  const vignette = document.createElement('div');
  vignette.className = 'xera-bg-vignette';
  const noise = document.createElement('div');
  noise.className = 'xera-bg-noise';
  layer.append(vignette, noise);
  document.body.prepend(layer);
  document.body.classList.add('xera-scene-enabled');

  // Continue the sequence between XERA page navigations during the same visit.
  const key = 'xera-scene-index';
  let current = Number(sessionStorage.getItem(key));
  if (!Number.isInteger(current) || current < 0 || current >= scenes.length) {
    current = Math.floor(Math.random() * scenes.length);
  }
  const show = (index) => {
    scenes.forEach((s, i) => {
      s.classList.toggle('active', i === index);
      s.classList.remove('previous');
    });
    sessionStorage.setItem(key, String(index));
  };
  show(current);

  // Preload all scenes so switching is smooth rather than flashing.
  bgPaths.forEach(src => { const img = new Image(); img.src = src; });

  if (!reduced) {
    window.setInterval(() => {
      current = (current + 1) % scenes.length;
      show(current);
    }, 11000);
  }

  // Existing ambient starfield behavior.
  const field = document.getElementById('xeraStarfield') || document.getElementById('xeraPublicStars');
  if (!field) return;

  const count = window.innerWidth < 640 ? 46 : window.innerWidth < 1000 ? 72 : 104;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const star = document.createElement('span');
    star.className = 'xera-star';
    const size = (Math.random() * 2 + 0.7).toFixed(2);
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.left = `${(Math.random() * 100).toFixed(2)}%`;
    star.style.top = `${(Math.random() * 100).toFixed(2)}%`;
    star.style.setProperty('--star-delay', `${(Math.random() * 7).toFixed(2)}s`);
    star.style.setProperty('--star-duration', `${(2.4 + Math.random() * 4).toFixed(2)}s`);
    star.style.setProperty('--star-opacity', `${(0.35 + Math.random() * 0.65).toFixed(2)}`);
    frag.appendChild(star);
  }
  if (!reduced) {
    for (let i = 0; i < 3; i++) {
      const shooting = document.createElement('span');
      shooting.className = 'xera-shooting-star';
      shooting.style.top = `${8 + Math.random() * 34}%`;
      shooting.style.left = `${58 + Math.random() * 35}%`;
      shooting.style.setProperty('--shoot-delay', `${(2 + i * 6 + Math.random() * 3).toFixed(2)}s`);
      frag.appendChild(shooting);
    }
  }
  field.appendChild(frag);
})();
