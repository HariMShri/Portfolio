// ============ YEAR ============
document.getElementById('year').textContent = new Date().getFullYear();

// ============ THEME TOGGLE ============
const themeToggle = document.getElementById('themeToggle');
const root = document.documentElement;
const themeIcon = themeToggle.querySelector('i');

function applyTheme(theme) {
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    themeIcon.classList.remove('fa-moon');
    themeIcon.classList.add('fa-sun');
  } else {
    root.setAttribute('data-theme', 'light');
    themeIcon.classList.remove('fa-sun');
    themeIcon.classList.add('fa-moon');
  }
}

let savedTheme = 'light';
try {
  savedTheme = localStorage.getItem('portfolio-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch (e) { /* ignore */ }
applyTheme(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('portfolio-theme', next); } catch (e) { /* ignore */ }
});

// ============ MOBILE NAV ============
const navToggle = document.getElementById('navToggle');
const nav = document.getElementById('nav');

navToggle.addEventListener('click', () => {
  nav.classList.toggle('open');
  navToggle.classList.toggle('open');
});

document.querySelectorAll('.nav__link').forEach(link => {
  link.addEventListener('click', () => {
    nav.classList.remove('open');
    navToggle.classList.remove('open');
  });
});

// ============ HEADER SCROLL STATE + PROGRESS BAR ============
const header = document.getElementById('header');
const progressBar = document.getElementById('progressBar');
const backToTop = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  progressBar.style.width = pct + '%';

  header.classList.toggle('scrolled', scrollTop > 20);
  backToTop.classList.toggle('show', scrollTop > 500);
}, { passive: true });

backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ============ SCROLL-DOWN CORD PULL ============
const scrollDown = document.querySelector('.scroll-down');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (scrollDown) {
  scrollDown.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(scrollDown.getAttribute('href'));
    if (!target) return;

    if (prefersReducedMotion || scrollDown.classList.contains('pulling')) {
      target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      return;
    }

    scrollDown.classList.add('pulling');
    setTimeout(() => target.scrollIntoView({ behavior: 'smooth' }), 430);
    scrollDown.addEventListener('animationend', () => scrollDown.classList.remove('pulling'), { once: true });
  });
}

// ============ SCROLL SPY ============
const sections = document.querySelectorAll('main section[id], .hero[id]');
const navLinks = document.querySelectorAll('.nav__link');

const spyObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.getAttribute('id');
      navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
      });
    }
  });
}, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

sections.forEach(sec => spyObserver.observe(sec));

// ============ SCROLL REVEAL ============
const revealEls = document.querySelectorAll('[data-reveal]');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

revealEls.forEach(el => revealObserver.observe(el));

// ============ TYPED ROLE EFFECT ============
const roles = [
  'Manual Test Engineer',
  'Senior Test Engineer',
  'QA Engineer',
  'API Testing Specialist'
];
const typedEl = document.getElementById('typedRole');
let roleIndex = 0, charIndex = 0, deleting = false;

function typeLoop() {
  const current = roles[roleIndex];
  if (!deleting) {
    charIndex++;
    typedEl.textContent = current.slice(0, charIndex);
    if (charIndex === current.length) {
      deleting = true;
      setTimeout(typeLoop, 1400);
      return;
    }
  } else {
    charIndex--;
    typedEl.textContent = current.slice(0, charIndex);
    if (charIndex === 0) {
      deleting = false;
      roleIndex = (roleIndex + 1) % roles.length;
    }
  }
  setTimeout(typeLoop, deleting ? 40 : 80);
}
typeLoop();

// ============ STAT COUNTERS ============
const statNums = document.querySelectorAll('.hero__stat-num');
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = parseInt(el.getAttribute('data-count'), 10);
      let count = 0;
      const step = Math.max(1, Math.ceil(target / 40));
      const tick = () => {
        count += step;
        if (count >= target) {
          el.textContent = target;
        } else {
          el.textContent = count;
          requestAnimationFrame(tick);
        }
      };
      tick();
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

statNums.forEach(el => counterObserver.observe(el));

// ============ CONTACT FORM (FormSubmit AJAX) ============
const contactForm = document.getElementById('contactForm');
const submitBtn = document.getElementById('submitBtn');
const submitText = document.getElementById('submitText');
const formStatus = document.getElementById('formStatus');

const FORM_ENDPOINT = 'https://formsubmit.co/ajax/m.shrihari04@gmail.com';

contactForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // honeypot spam trap
  if (contactForm._honey && contactForm._honey.value) return;

  const formData = new FormData(contactForm);
  const payload = Object.fromEntries(formData.entries());

  submitBtn.disabled = true;
  submitText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
  formStatus.textContent = '';
  formStatus.className = 'form__status';

  try {
    const res = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      formStatus.textContent = "Message sent! I'll get back to you soon.";
      formStatus.classList.add('success');
      contactForm.reset();
    } else {
      throw new Error('Request failed');
    }
  } catch (err) {
    formStatus.textContent = 'Something went wrong. Please email me directly at m.shrihari04@gmail.com';
    formStatus.classList.add('error');
    if (localStorage.getItem('aiVoiceEnabled') !== 'false') {
      new Audio('assets/voice/form_error.mp3').play().catch(() => {
        if (window.speechSynthesis) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(formStatus.textContent));
        }
      });
    }
  } finally {
    submitBtn.disabled = false;
    submitText.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
  }
});

// ============ PORTAL EFFECT HERO SLIDER ============
(function portalSlider() {
  const slider = document.getElementById('portalSlider');
  if (!slider) return;

  const slides = Array.from(slider.querySelectorAll('.portal-slide'));
  const gates = Array.from(slider.querySelectorAll('.portal-gate'));
  const prevBtn = document.getElementById('portalPrev');
  const nextBtn = document.getElementById('portalNext');
  const flashEl = document.getElementById('portalFlash');
  const titleEl = document.getElementById('portalTitle');
  const descEl = document.getElementById('portalDesc');

  const DATA = [
    { title: 'QA & Test Engineering', desc: '5+ years across manual, functional & release testing' },
    { title: 'API & Backend Validation', desc: 'Postman · Swagger · SQL · Cassandra · Kafka' },
    { title: 'Automation & DevOps Tooling', desc: 'Java · Selenium · PyTest · Docker · Kubernetes' }
  ];

  const AUTOPLAY_MS = 5500;
  const TRANSITION_MS = 850;

  let current = 0;
  let busy = false;
  let autoplayTimer = null;

  function flashPortal() {
    flashEl.classList.remove('flash');
    void flashEl.offsetWidth; // restart animation
    flashEl.classList.add('flash');
  }

  function updateCaption(index) {
    titleEl.style.opacity = '0';
    descEl.style.opacity = '0';
    titleEl.style.transform = 'translateY(6px)';
    descEl.style.transform = 'translateY(6px)';
    setTimeout(() => {
      titleEl.textContent = DATA[index].title;
      descEl.textContent = DATA[index].desc;
      titleEl.style.opacity = '1';
      descEl.style.opacity = '1';
      titleEl.style.transform = 'translateY(0)';
      descEl.style.transform = 'translateY(0)';
    }, 260);
  }

  function updateGates(index) {
    gates.forEach((g, i) => g.classList.toggle('active', i === index));
  }

  function goTo(index) {
    if (index === current || busy) return;
    busy = true;

    const prevSlide = slides[current];
    const nextSlide = slides[index];

    prevSlide.classList.remove('active');
    prevSlide.classList.add('portal-out');

    nextSlide.classList.add('active', 'portal-in');

    flashPortal();
    updateCaption(index);
    updateGates(index);

    current = index;

    setTimeout(() => {
      prevSlide.classList.remove('portal-out');
      nextSlide.classList.remove('portal-in');
      busy = false;
    }, TRANSITION_MS);
  }

  function nextSlideIndex() { return (current + 1) % slides.length; }
  function prevSlideIndex() { return (current - 1 + slides.length) % slides.length; }

  function startAutoplay() {
    stopAutoplay();
    autoplayTimer = setInterval(() => goTo(nextSlideIndex()), AUTOPLAY_MS);
  }
  function stopAutoplay() {
    if (autoplayTimer) clearInterval(autoplayTimer);
  }
  function restartAutoplay() { startAutoplay(); }

  nextBtn.addEventListener('click', () => { goTo(nextSlideIndex()); restartAutoplay(); });
  prevBtn.addEventListener('click', () => { goTo(prevSlideIndex()); restartAutoplay(); });
  gates.forEach((gate) => {
    gate.addEventListener('click', () => {
      goTo(parseInt(gate.getAttribute('data-goto'), 10));
      restartAutoplay();
    });
  });

  slider.addEventListener('mouseenter', stopAutoplay);
  slider.addEventListener('mouseleave', startAutoplay);
  slider.addEventListener('focusin', stopAutoplay);
  slider.addEventListener('focusout', startAutoplay);

  startAutoplay();
})();

// ============ HIDDEN EASTER-EGG GAME: BUG SQUASH ============
(function bugSquashGame() {
  const overlay = document.getElementById('gameOverlay');
  const closeBtn = document.getElementById('gameClose');
  const gameArea = document.getElementById('gameArea');
  const startPanel = document.getElementById('gameStart');
  const overPanel = document.getElementById('gameOverPanel');
  const startBtn = document.getElementById('gameStartBtn');
  const retryBtn = document.getElementById('gameRetryBtn');
  const scoreEl = document.getElementById('gameScore');
  const timeEl = document.getElementById('gameTime');
  const bestEl = document.getElementById('gameBest');
  const finalScoreEl = document.getElementById('finalScore');
  const overTitleEl = document.getElementById('gameOverTitle');

  const GAME_DURATION = 30;
  const SPAWN_INTERVAL = 700;
  const BUG_LIFETIME = 1300;
  const HIGH_SCORE_KEY = 'bugSquashHighScore';

  let score = 0;
  let timeLeft = GAME_DURATION;
  let spawnTimer = null;
  let countdownTimer = null;
  let running = false;

  function getHighScore() {
    try { return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function setHighScore(val) {
    try { localStorage.setItem(HIGH_SCORE_KEY, String(val)); } catch (e) { /* ignore */ }
  }

  bestEl.textContent = getHighScore();

  function openGame() {
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    resetToStart();
  }

  function closeGame() {
    overlay.hidden = true;
    document.body.style.overflow = '';
    stopGame();
  }

  function resetToStart() {
    stopGame();
    score = 0;
    timeLeft = GAME_DURATION;
    scoreEl.textContent = '0';
    timeEl.textContent = String(GAME_DURATION);
    bestEl.textContent = getHighScore();
    gameArea.querySelectorAll('.game-bug, .score-pop').forEach(el => el.remove());
    overPanel.hidden = true;
    startPanel.hidden = false;
  }

  function startGame() {
    score = 0;
    timeLeft = GAME_DURATION;
    scoreEl.textContent = '0';
    timeEl.textContent = String(GAME_DURATION);
    startPanel.hidden = true;
    overPanel.hidden = true;
    running = true;

    spawnTimer = setInterval(spawnBug, SPAWN_INTERVAL);
    countdownTimer = setInterval(() => {
      timeLeft--;
      timeEl.textContent = String(Math.max(timeLeft, 0));
      if (timeLeft <= 0) endGame();
    }, 1000);

    spawnBug();
  }

  function stopGame() {
    running = false;
    clearInterval(spawnTimer);
    clearInterval(countdownTimer);
    gameArea.querySelectorAll('.game-bug').forEach(el => el.remove());
  }

  function endGame() {
    stopGame();
    const best = getHighScore();
    const isNewBest = score > best;
    if (isNewBest) setHighScore(score);
    bestEl.textContent = getHighScore();

    finalScoreEl.textContent = String(score);
    overTitleEl.textContent = isNewBest ? 'New High Score! 🎉' : 'Release Complete!';
    overPanel.hidden = false;
  }

  function spawnBug() {
    if (!running) return;
    const bug = document.createElement('button');
    bug.className = 'game-bug';
    bug.type = 'button';
    bug.innerHTML = '<i class="fa-solid fa-bug"></i>';
    bug.setAttribute('aria-label', 'Squash bug');

    const areaRect = gameArea.getBoundingClientRect();
    const maxX = Math.max(areaRect.width - 48, 10);
    const maxY = Math.max(areaRect.height - 48, 10);
    bug.style.left = Math.random() * maxX + 'px';
    bug.style.top = Math.random() * maxY + 'px';

    const life = setTimeout(() => {
      if (bug.isConnected) bug.remove();
    }, BUG_LIFETIME);

    bug.addEventListener('click', () => {
      clearTimeout(life);
      score++;
      scoreEl.textContent = String(score);
      showScorePop(bug.style.left, bug.style.top, '+1');
      bug.classList.add('squashed');
      setTimeout(() => bug.remove(), 180);
    });

    gameArea.appendChild(bug);
  }

  function showScorePop(left, top, text) {
    const pop = document.createElement('span');
    pop.className = 'score-pop';
    pop.textContent = text;
    pop.style.left = left;
    pop.style.top = top;
    gameArea.appendChild(pop);
    setTimeout(() => pop.remove(), 650);
  }

  startBtn.addEventListener('click', startGame);
  retryBtn.addEventListener('click', startGame);
  closeBtn.addEventListener('click', closeGame);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGame(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeGame();
  });

  // ---- Konami Code listener ----
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiProgress = 0;

  document.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const expected = KONAMI[konamiProgress];
    if (key === expected) {
      konamiProgress++;
      if (konamiProgress === KONAMI.length) {
        konamiProgress = 0;
        openGame();
      }
    } else {
      konamiProgress = (key === KONAMI[0]) ? 1 : 0;
    }
  });

  console.log(
    '%c🐛 Psst... found a bug?\n%cTry the Konami Code: ↑ ↑ ↓ ↓ ← → ← → B A',
    'color:#4f46e5;font-size:16px;font-weight:700;',
    'color:#06b6d4;font-size:13px;font-weight:600;'
  );
})();

// ============ AI ASSISTANT WIDGET ============
(function aiAssistant() {
  const widget = document.getElementById('aiWidget');
  const launcher = document.getElementById('aiLauncher');
  const panel = document.getElementById('aiPanel');
  const closeBtn = document.getElementById('aiClose');
  const messagesEl = document.getElementById('aiMessages');
  const suggestionsEl = document.getElementById('aiSuggestions');
  const form = document.getElementById('aiForm');
  const input = document.getElementById('aiInput');
  const voiceToggle = document.getElementById('aiVoiceToggle');
  const micBtn = document.getElementById('aiMic');
  if (!widget || !launcher || !panel) return;

  // ---- Voice output ----
  // Recorded clips of Shri Hari's real voice, keyed by KB intent id. Drop matching
  // audio files into assets/voice/ and they'll play instead of the browser TTS voice.
  // Anything not listed here (or if a file is missing/unplayable) falls back to TTS.
  const VOICE_CLIPS = {
    about: 'assets/voice/about.mp3',
    greeting: 'assets/voice/greeting.mp3',
    experience: 'assets/voice/experience.mp3',
    skills: 'assets/voice/skills.mp3',
    education: 'assets/voice/education.mp3',
    certifications: 'assets/voice/certifications.mp3',
    strengths: 'assets/voice/strengths.mp3',
    contact: 'assets/voice/contact.mp3',
    fallback: 'assets/voice/fallback.mp3',
    mic_error: 'assets/voice/mic_error.mp3'
  };

  const MIC_ERROR_MSG = "Sorry, I couldn't hear that clearly. Please try again, or type your question instead.";

  const synth = window.speechSynthesis || null;
  let voiceEnabled = localStorage.getItem('aiVoiceEnabled') !== 'false';
  let currentAudio = null;

  function stopVoice() {
    if (synth) synth.cancel();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  }

  function updateVoiceToggleUI() {
    if (!voiceToggle) return;
    voiceToggle.setAttribute('aria-pressed', String(voiceEnabled));
    voiceToggle.setAttribute('aria-label', voiceEnabled ? 'Mute voice replies' : 'Unmute voice replies');
    voiceToggle.innerHTML = voiceEnabled
      ? '<i class="fa-solid fa-volume-high"></i>'
      : '<i class="fa-solid fa-volume-xmark"></i>';
  }

  function pickVoice() {
    if (!synth) return null;
    const voices = synth.getVoices();
    if (!voices.length) return null;
    return voices.find(v => /en[-_](US|GB|IN)/i.test(v.lang) && /female|zira|samantha|google us english/i.test(v.name))
      || voices.find(v => v.lang && v.lang.startsWith('en'))
      || voices[0];
  }

  function speakWithBrowserTTS(text) {
    if (!synth || !text) return;
    synth.cancel();
    const clean = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/[📧📱📍]/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .trim();
    if (!clean) return;
    const utter = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.rate = 1;
    utter.pitch = 1;
    utter.onstart = () => voiceToggle && voiceToggle.classList.add('speaking');
    utter.onend = () => voiceToggle && voiceToggle.classList.remove('speaking');
    utter.onerror = () => voiceToggle && voiceToggle.classList.remove('speaking');
    synth.speak(utter);
  }

  function playClip(url, fallbackText) {
    stopVoice();
    const audio = new Audio(url);
    currentAudio = audio;
    audio.addEventListener('playing', () => voiceToggle && voiceToggle.classList.add('speaking'));
    audio.addEventListener('ended', () => {
      voiceToggle && voiceToggle.classList.remove('speaking');
      if (currentAudio === audio) currentAudio = null;
    });
    audio.addEventListener('error', () => {
      voiceToggle && voiceToggle.classList.remove('speaking');
      if (currentAudio === audio) currentAudio = null;
      speakWithBrowserTTS(fallbackText);
    });
    audio.play().catch(() => speakWithBrowserTTS(fallbackText));
  }

  function speak(text, intentId) {
    if (!voiceEnabled || !text) return;
    const clipUrl = intentId && VOICE_CLIPS[intentId];
    if (clipUrl) {
      playClip(clipUrl, text);
    } else {
      speakWithBrowserTTS(text);
    }
  }

  if (voiceToggle) {
    updateVoiceToggleUI();
    voiceToggle.addEventListener('click', () => {
      voiceEnabled = !voiceEnabled;
      localStorage.setItem('aiVoiceEnabled', String(voiceEnabled));
      updateVoiceToggleUI();
      if (!voiceEnabled) stopVoice();
    });
  }

  // ---- Voice input (speech-to-text) ----
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (micBtn) {
    if (!SpeechRecognitionAPI) {
      micBtn.hidden = true;
    } else {
      recognition = new SpeechRecognitionAPI();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript.trim();
        if (transcript) {
          input.value = transcript;
          respond(transcript);
          input.value = '';
        }
      };
      recognition.onend = () => {
        listening = false;
        micBtn.classList.remove('listening');
      };
      recognition.onerror = (e) => {
        listening = false;
        micBtn.classList.remove('listening');
        if (e && e.error === 'aborted') return; // user manually stopped it — not a real error
        addBotMessage(MIC_ERROR_MSG, 'mic_error');
      };

      micBtn.addEventListener('click', () => {
        if (listening) {
          recognition.stop();
          return;
        }
        stopVoice();
        try {
          recognition.start();
          listening = true;
          micBtn.classList.add('listening');
          input.placeholder = 'Listening...';
        } catch (err) {
          listening = false;
        }
      });
      recognition.addEventListener('end', () => {
        input.placeholder = 'Ask about skills, experience, contact...';
      });
    }
  }

  // ---- Knowledge base built from Shri Hari's resume data on this page ----
  const KB = [
    {
      id: 'greeting',
      keywords: ['hi', 'hello', 'hey', 'yo', 'greetings', 'sup'],
      reply: "Hi there 👋 I'm the AI assistant for Shri Hari M's profile. Ask me anything — skills, experience, education, certifications, or how to get in touch — and I'll answer as he would."
    },
    {
      id: 'about',
      keywords: ['about', 'who', 'summary', 'overview', 'background', 'profile', 'introduce', 'yourself'],
      reply: "I'm a Senior Test Engineer with 5+ years in software QA — manual, functional, regression, integration, system, smoke/sanity and end-to-end testing, plus API testing, database validation, defect management and release readiness. Most of my experience is on enterprise Nokia Network Management System platforms, across application, API, messaging (Kafka), adapter, database, protocol, container, OS and network-management layers."
    },
    {
      id: 'experience',
      keywords: ['experience', 'history', 'career', 'companies', 'roles', 'worked', 'job'],
      reply: "Here's my career path:\n\n• **Tech Mahindra** — Senior Test Engineer (Jul 2026–Present), client Infinera\n• **Wipro Technologies** — Senior Project Engineer, QA (Dec 2025–Jul 2026), client Nokia NMS\n• **Wipro Technologies** — Student Trainee (Aug 2021–Nov 2025), client Nokia NMS\n\nAcross my time at Wipro I executed 300+ test cases per release and triaged 1,000+ defects across 10 major releases on Nokia's NMS platform. Ask me about \"Tech Mahindra\" or \"Wipro/Nokia\" for more detail on either."
    },
    {
      id: 'current_role',
      keywords: ['tech', 'mahindra', 'infinera', 'currently'],
      reply: "I'm currently a Senior Test Engineer at Tech Mahindra (since Jul 2026), working with the Infinera client. I'm getting up to speed on the product architecture, business workflows and release practices, while supporting functional, regression, API and system-level validation alongside the dev and QA teams."
    },
    {
      id: 'wipro_nokia',
      keywords: ['wipro', 'nokia', 'nms', 'network', 'previous'],
      reply: "I spent over 4.5 years at Wipro Technologies on the Nokia Network Management System account — starting as a Student Trainee (Aug 2021–Nov 2025) and getting promoted to Senior Project Engineer – QA (Dec 2025–Jul 2026) after completing my M.Tech.\n\nThere I executed 300+ test cases per release and triaged 1,000+ defects across 10 major releases, including NETCONF/SNMP protocol testing between the NMS platform and managed network devices, Kafka message-flow validation, SQL/Cassandra backend checks, and automated regression suites in Java/TestNG/Maven."
    },
    {
      id: 'skills',
      keywords: ['skills', 'skillset', 'competencies', 'stack', 'technologies', 'expertise'],
      reply: "My core QA competencies:\n\n• **Manual Testing** — functional, regression, integration, system, smoke, sanity, E2E, UAT\n• **API & Backend** — Postman, Swagger, REST, JSON/XML\n• **Database** — SQL, Cassandra, data integrity/consistency\n• **Integration** — Kafka, adapter testing, message flow validation\n• **Defect Management** — JIRA lifecycle, RCA, triage\n• **Automation** — Java, TestNG, Maven, Selenium, Python, PyTest, Playwright\n• **Tools** — Jenkins, Git/GitLab, Docker, Kubernetes, Linux/RHEL, SonarQube, Prometheus, Grafana\n\nAsk about any one of these areas for more detail."
    },
    {
      id: 'ai_usage',
      keywords: ['copilot', 'cursor', 'github copilot', 'chatgpt', 'artificial intelligence', 'ai tools', 'root cause analysis'],
      reply: "AI is part of my daily QA workflow, not just a novelty. I use **GitHub Copilot** day-to-day while building and maintaining automation scripts — it speeds up boilerplate so I can focus more on test logic and edge cases. I use **Cursor** for failure analysis and root-cause analysis on issues that surface under load, narrowing down where a problem originates instead of stepping through logs manually. I also built this very AI assistant myself — a resume-trained chatbot with voice input/output and a cloned-voice integration — as a hands-on AI project beyond day-to-day tooling."
    },
    {
      id: 'automation',
      keywords: ['automation', 'selenium', 'testng', 'playwright', 'pytest', 'coding', 'programming', 'scripting', 'python', 'java'],
      reply: "I have automation exposure with Java, TestNG and Maven (built automated regression suites in Eclipse), plus Python, PyTest and Playwright. I use these to complement manual testing — automating regression coverage so I can focus manual effort on exploratory and release-risk areas."
    },
    {
      id: 'api',
      keywords: ['api', 'postman', 'swagger', 'rest', 'json', 'xml'],
      reply: "Yes — I do hands-on REST API testing with Postman and Swagger, validating JSON/XML responses, status codes, and request/response contracts. This is paired with backend validation (SQL, Cassandra) to confirm data actually lands correctly, not just that the API returns 200."
    },
    {
      id: 'database',
      keywords: ['database', 'sql', 'cassandra'],
      reply: "I handle database testing with SQL and Cassandra — checking data integrity and consistency, validating that application actions produce the correct backend state, and cross-checking data across layers."
    },
    {
      id: 'kafka',
      keywords: ['kafka', 'messaging', 'adapter', 'integration'],
      reply: "I've validated Kafka request/response flows and adapter/integration workflows between application components — confirming messages are produced, consumed and transformed correctly across upstream/downstream systems."
    },
    {
      id: 'tools',
      keywords: ['jira', 'confluence', 'jenkins', 'git', 'gitlab', 'docker', 'kubernetes', 'linux', 'sonarqube', 'grafana', 'prometheus', 'devops', 'tools'],
      reply: "Day-to-day tools: JIRA & Confluence for planning/tracking, Jenkins & Git/GitLab for CI and version control, Docker & Kubernetes for containerized environments, Linux/RHEL for ops-level checks, and SonarQube, JaCoCo, Prometheus & Grafana for code quality and service monitoring."
    },
    {
      id: 'education',
      keywords: ['education', 'degree', 'qualification', 'mtech', 'study', 'university', 'college', 'bits', 'pilani'],
      reply: "I hold an M.Tech in Software Systems from BITS Pilani (WILP), completed in 2025 — pursued part-time alongside full-time work, sponsored as part of Wipro's employment program. My promotion to Senior Project Engineer followed right after I completed it."
    },
    {
      id: 'certifications',
      keywords: ['certification', 'certifications', 'certificate', 'certified', 'credential', 'badge', 'certs'],
      reply: "A few certifications: GitHub Copilot – Level 2, Wipro TalentNext, internal QA & Agile certifications from Wipro, and a \"Build with Gemini\" AI Skill Badge from Google Cloud (issued Sep 2026, Credly-verified)."
    },
    {
      id: 'contact',
      keywords: ['contact', 'email', 'phone', 'reach', 'call', 'number'],
      reply: "You can reach me directly:\n📧 m.shrihari04@gmail.com\n📱 +91 97896 51058\n📍 Bangalore, Karnataka, India\n\nOr just use the contact form on this page — I personally reply to every message."
    },
    {
      id: 'resume',
      keywords: ['resume', 'cv', 'download'],
      reply: "You can download my full resume as a PDF using the \"Resume\" or \"Download CV\" button at the top of this page — it has all the role-by-role detail."
    },
    {
      id: 'location',
      keywords: ['location', 'based', 'bangalore', 'relocate', 'relocation', 'city'],
      reply: "I'm based in Bangalore, Karnataka, India. For specifics on relocation or remote/hybrid preferences for a particular role, it's best to ask me directly by email or phone — happy to discuss."
    },
    {
      id: 'availability',
      keywords: ['availability', 'available', 'notice', 'join', 'joining'],
      reply: "Notice period and joining timelines are best confirmed directly — reach out via email (m.shrihari04@gmail.com) or phone (+91 97896 51058) and I'll get back to you personally with specifics."
    },
    {
      id: 'salary',
      keywords: ['salary', 'compensation', 'ctc', 'pay'],
      reply: "Compensation expectations depend on the role and scope, so that's a conversation I'd rather have directly — feel free to reach out by email or phone and we can discuss."
    },
    {
      id: 'strengths',
      keywords: ['strength', 'strengths', 'hire', 'unique', 'standout'],
      reply: "A few things I'd highlight: 5+ years of enterprise-grade QA on a complex, multi-layer platform (Nokia NMS), executing 300+ test cases per release and triaging 1,000+ defects across 10 major releases — not just UI testing, but API, database, NETCONF/SNMP protocol, messaging and infra-level validation too. I own the full defect lifecycle end-to-end, I'm comfortable across manual and automation, and I completed a rigorous M.Tech while working full-time, which says a lot about how I manage workload and follow-through."
    },
    {
      id: 'social',
      keywords: ['linkedin', 'github', 'social'],
      reply: "You can find me on LinkedIn (linkedin.com/in/shri-hari-80a6a01b2) and GitHub (github.com/HariMShri) — links are also in the header and footer of this page."
    },
    {
      id: 'assistant_built',
      keywords: ['developed you', 'built you', 'made you', 'created you', 'build this chatbot', 'built this chatbot', 'build this assistant', 'built this assistant', 'how were you made', 'how were you built', 'who built you', 'who made you', 'how do you work', 'how does this chatbot work', 'how does this assistant work'],
      reply: "Shri Hari built me himself, working with Claude (Anthropic's AI) inside Claude Code. I'm a resume-trained chatbot — most of my answers come from a curated knowledge base of his real experience, skills and background, matched by keyword to whatever you ask. I also have voice input and output, including a cloned version of his real voice for some replies, plus a live AI layer (Gemini, via a Cloudflare Worker) for more open-ended questions the fixed knowledge base doesn't already cover. Ask me about \"AI tools\" if you'd like to know how he uses AI in his day job too, not just on this site."
    },
    {
      id: 'thanks',
      keywords: ['thanks', 'thank', 'appreciate'],
      reply: "You're welcome! Let me know if there's anything else you'd like to know, or use the contact form below to reach me directly."
    },
    {
      id: 'bye',
      keywords: ['bye', 'goodbye'],
      reply: "Thanks for stopping by! Feel free to reach out anytime at m.shrihari04@gmail.com — looking forward to hearing from you."
    }
  ];

  const FALLBACK = "That's a great question, but it's not something in my training data yet 🙂 For specifics like that, reach out directly — m.shrihari04@gmail.com or +91 97896 51058 — or try asking about skills, experience, education or how to get in touch.";
  const GREETING = KB[0].reply;

  let opened = false;
  let mailFlow = null;

  function normalize(str) {
    return ' ' + str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }

  function matchIntent(text) {
    const norm = normalize(text);
    let best = null;
    let bestScore = 0;
    KB.forEach(intent => {
      let score = 0;
      intent.keywords.forEach(kw => {
        if (norm.includes(' ' + kw + ' ')) score += kw.split(' ').length;
      });
      if (score > bestScore) {
        bestScore = score;
        best = intent;
      }
    });
    return best;
  }

  function formatBotText(text) {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBotMessage(text, intentId) {
    const bubble = document.createElement('div');
    bubble.className = 'ai-msg ai-msg--bot';
    bubble.innerHTML = formatBotText(text);
    messagesEl.appendChild(bubble);
    scrollToBottom();
    speak(text, intentId);
  }

  function addUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'ai-msg ai-msg--user';
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    scrollToBottom();
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'ai-typing';
    typing.id = 'aiTypingIndicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typing);
    scrollToBottom();
  }

  function hideTyping() {
    const typing = document.getElementById('aiTypingIndicator');
    if (typing) typing.remove();
  }

  // ---- Live AI (Cloudflare Worker -> Gemini), with local KB as fallback ----
  // Set this to the workers.dev URL printed by `npx wrangler deploy` in ai-worker/.
  // Left blank until deployed -- askLiveAI() no-ops (returns null) until it's set,
  // so the widget just runs on the local KB alone in the meantime.
  const AI_WORKER_URL = 'https://shrihari-portfolio-ai.shriharigamer.workers.dev';
  const AI_TIMEOUT_MS = 10000;

  async function askLiveAI(userText) {
    if (!AI_WORKER_URL) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const res = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.reply || null;
    } catch (e) {
      return null; // network error, timeout, rate-limited, etc. -- fall back to KB
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---- "Send a mail to him" conversational flow ----
  // Lets a recruiter/visitor ask the assistant to relay a message. Collects
  // name -> email -> subject -> message turn by turn, then submits through
  // the same FormSubmit endpoint the main contact form uses (FORM_ENDPOINT
  // is declared near the top of this file, in the contact-form section).
  const MAIL_TRIGGERS = [
    'send a mail', 'send mail', 'send an email', 'send email',
    'send him a mail', 'send him an email', 'send him mail', 'send him email',
    'mail him', 'email him', 'send a message to him', 'send him a message',
    'compose a mail', 'compose an email'
  ];
  const MAIL_STEPS = ['name', 'email', 'subject', 'message'];
  const DEFAULT_PLACEHOLDER = 'Ask about skills, experience, contact...';

  function isMailTrigger(text) {
    const norm = normalize(text);
    return MAIL_TRIGGERS.some(kw => norm.includes(' ' + kw + ' '));
  }

  function mailStepPrompt(step, data) {
    switch (step) {
      case 'name': return "Sure — I can pass a message along to him directly. What's your name?";
      case 'email': return `Thanks, ${data.name}! What's your email address, so he can reply to you?`;
      case 'subject': return "Got it. What's the subject of your message?";
      case 'message': return "And what would you like the message to say?";
      default: return '';
    }
  }

  function setSuggestionsVisible(visible) {
    if (suggestionsEl) suggestionsEl.style.display = visible ? '' : 'none';
  }

  function startMailFlow() {
    mailFlow = { step: 0, data: {} };
    setSuggestionsVisible(false);
    input.placeholder = 'Type your name, or "cancel" to stop...';
    addBotMessage(mailStepPrompt('name', {}), null);
  }

  function cancelMailFlow(message) {
    mailFlow = null;
    setSuggestionsVisible(true);
    input.placeholder = DEFAULT_PLACEHOLDER;
    addBotMessage(message, null);
  }

  async function submitMailFlow(data) {
    showTyping();
    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          _subject: `New message via AI Assistant from ${data.name}`
        })
      });
      hideTyping();
      if (res.ok) {
        addBotMessage(`Thanks, ${data.name}! I've sent that to Shri Hari — he personally replies to every message, so you should hear back soon.`, null);
      } else {
        throw new Error('send failed');
      }
    } catch (e) {
      hideTyping();
      addBotMessage('Sorry, something went wrong sending that. Please email him directly at m.shrihari04@gmail.com instead.', null);
    } finally {
      setSuggestionsVisible(true);
      input.placeholder = DEFAULT_PLACEHOLDER;
    }
  }

  function handleMailFlowInput(userText) {
    const trimmed = userText.trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'cancel' || lower === 'stop' || lower === 'never mind' || lower === 'nevermind') {
      cancelMailFlow("No problem, cancelled. Let me know if you'd like to try again, or ask me anything else.");
      return;
    }

    const stepName = MAIL_STEPS[mailFlow.step];

    if (stepName === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      addBotMessage('That doesn\'t look like a valid email address — mind double-checking it? (or type "cancel" to stop)', null);
      return;
    }

    mailFlow.data[stepName] = trimmed;
    mailFlow.step++;

    if (mailFlow.step < MAIL_STEPS.length) {
      addBotMessage(mailStepPrompt(MAIL_STEPS[mailFlow.step], mailFlow.data), null);
    } else {
      const data = mailFlow.data;
      mailFlow = null;
      setSuggestionsVisible(true);
      input.placeholder = DEFAULT_PLACEHOLDER;
      submitMailFlow(data);
    }
  }

  async function respond(userText) {
    addUserMessage(userText);

    if (mailFlow) {
      handleMailFlowInput(userText);
      return;
    }

    if (isMailTrigger(userText)) {
      startMailFlow();
      return;
    }

    showTyping();
    const minDelay = new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 400));
    const [liveReply] = await Promise.all([askLiveAI(userText), minDelay]);
    hideTyping();
    if (liveReply) {
      addBotMessage(liveReply, null); // no static voice clip for a live-generated reply -- falls back to browser TTS
    } else {
      const intent = matchIntent(userText);
      addBotMessage(intent ? intent.reply : FALLBACK, intent ? intent.id : 'fallback');
    }
  }

  function openPanel() {
    widget.classList.add('open');
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    if (!opened) {
      opened = true;
      showTyping();
      setTimeout(() => {
        hideTyping();
        addBotMessage(GREETING, 'greeting');
      }, 500);
    }
    setTimeout(() => input && input.focus(), 300);
  }

  function closePanel() {
    widget.classList.remove('open');
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    stopVoice();
    if (recognition && listening) recognition.stop();
    if (mailFlow) {
      mailFlow = null;
      setSuggestionsVisible(true);
      input.placeholder = DEFAULT_PLACEHOLDER;
    }
  }

  launcher.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = input.value.trim();
    if (!val) return;
    respond(val);
    input.value = '';
  });

  suggestionsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.ai-chip');
    if (!chip) return;
    respond(chip.getAttribute('data-q') || chip.textContent);
  });
})();