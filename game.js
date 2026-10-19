// ===== Configuración =====
const canvas = document.getElementById("juego");
const ctx = canvas.getContext("2d");

const H = 600;  // alto lógico del juego (siempre el mismo)
let W = 400;    // ancho lógico: cambia según la forma de la pantalla

const ALTURA_SUELO = 80;
const GRAVEDAD = 1500;      // px/s²
const FUERZA_SALTO = -440;  // px/s (negativo = hacia arriba)
const ANCHO_TUBO = 64;

// ===== Niveles =====
// hasta: el nivel dura hasta esa puntuación
// separacion: distancia entre tubos (menos = más pegaditos)
// hueco: espacio libre por donde pasa el pájaro
// saltoMax: cuánto puede variar la altura del hueco de un tubo al siguiente
const META = 50;
const NIVELES = {
  1: { hasta: 10, separacion: 280, hueco: 165, velocidad: 150, saltoMax: 190 },
  2: { hasta: 25, separacion: 220, hueco: 150, velocidad: 175, saltoMax: 150 },
  3: { hasta: 50, separacion: 170, hueco: 138, velocidad: 200, saltoMax: 110 },
};
const SUBTITULOS = {
  1: "Despegamos",
  2: "Se hace tarde...",
  3: "No mires atrás",
};

function nivelPorPuntaje(p) {
  if (p < NIVELES[1].hasta) return 1;
  if (p < NIVELES[2].hasta) return 2;
  return 3;
}

// ===== Estado del juego =====
let estado = "inicio"; // "inicio" | "jugando" | "fin" | "victoria"
let pajaro, tubos, nubes, puntaje, velocidad, nivel;
let tubosCreados, ultimoCentro;
let estrellas = null;
let murcielagos = null;
let confeti = [];
let oscuridad = 0;       // 0 = día alegre, 1 = noche tétrica
let desplazamientoSuelo = 0;
let fondoX = 0;
let tiempo = 0;
let tiempoFin = 0;
let bannerTiempo = 0;
let destello = 0;
let proximoRelampago = 6;
let mejor = 0;

try {
  mejor = Number(localStorage.getItem("flappy-mejor")) || 0;
} catch (e) {
  mejor = 0;
}

// ===== Pantalla completa =====
function ajustarPantalla() {
  const dpr = window.devicePixelRatio || 1;
  const escala = window.innerHeight / H;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  W = window.innerWidth / escala;
  ctx.setTransform(escala * dpr, 0, 0, escala * dpr, 0, 0);
  if (pajaro) pajaro.x = posicionPajaro();
}

function posicionPajaro() {
  return Math.max(70, Math.min(150, W * 0.25));
}

// ===== Utilidades =====
function limitar01(v) {
  return Math.max(0, Math.min(1, v));
}

function hexARgb(c) {
  return [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
}

function mezclar(a, b, t) {
  const A = hexARgb(a);
  const B = hexARgb(b);
  const r = Math.round(A[0] + (B[0] - A[0]) * t);
  const g = Math.round(A[1] + (B[1] - A[1]) * t);
  const bl = Math.round(A[2] + (B[2] - A[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

// Colores: [de día, de noche]. Se mezclan según "oscuridad".
const PALETA = {
  cieloArriba: ["#5db7d6", "#06030b"],
  cieloAbajo: ["#f6d5a8", "#4a0f1c"],
  colinas: ["#8fc9a0", "#150f1c"],
  nubes: ["#ffffff", "#2b2233"],
  suelo: ["#d9b26f", "#1e1620"],
  pasto: ["#6bbf59", "#2a3828"],
  pastoOscuro: ["#4c9a3e", "#18231a"],
  sueloLinea: ["#b8924f", "#100b12"],
  tuboCuerpo: ["#2f8a5a", "#2b3b31"],
  tuboLuz: ["#4fb67c", "#45594b"],
  tuboSombra: ["#1f6040", "#131c16"],
  tuboBorde: ["#17492f", "#070d09"],
};

function col(nombre) {
  return mezclar(PALETA[nombre][0], PALETA[nombre][1], oscuridad);
}

// ===== Sonido sencillo (se crea al primer toque) =====
let audio = null;
function beep(frecuencia, duracion, tipo = "square", volumen = 0.06) {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    osc.type = tipo;
    osc.frequency.value = frecuencia;
    vol.gain.setValueAtTime(volumen, audio.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duracion);
    osc.connect(vol);
    vol.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duracion);
  } catch (e) {}
}

function sonidoNivel(n) {
  const notas = n === 2 ? [392, 330, 262] : [196, 147, 98];
  notas.forEach((f, i) => setTimeout(() => beep(f, 0.25, "triangle", 0.08), i * 140));
}

function sonidoVictoria() {
  [523, 659, 784, 1047, 1319].forEach((f, i) =>
    setTimeout(() => beep(f, 0.3, "triangle", 0.08), i * 150)
  );
}

// ===== Inicialización =====
function reiniciar() {
  pajaro = { x: posicionPajaro(), y: (H - ALTURA_SUELO) / 2, vy: 0, radio: 14, angulo: 0 };
  tubos = [];
  tubosCreados = 0;
  ultimoCentro = null;
  puntaje = 0;
  nivel = 1;
  velocidad = NIVELES[1].velocidad;
  bannerTiempo = 0;
  confeti = [];
  estado = "inicio";

  if (!nubes) {
    nubes = [];
    for (let i = 0; i < 5; i++) {
      nubes.push({
        x: Math.random() * W,
        y: 40 + Math.random() * 220,
        escala: 0.6 + Math.random() * 0.9,
        vel: 8 + Math.random() * 14,
      });
    }
  }
  if (!estrellas) {
    estrellas = [];
    for (let i = 0; i < 80; i++) {
      estrellas.push({
        x: Math.random(),
        y: Math.random() * 340,
        r: 0.6 + Math.random() * 1.3,
        f: Math.random() * 6,
      });
    }
  }
  if (!murcielagos) {
    murcielagos = [];
    for (let i = 0; i < 5; i++) {
      murcielagos.push({
        x: Math.random() * W,
        y: 90 + Math.random() * 230,
        vel: 45 + Math.random() * 55,
        f: Math.random() * 6,
      });
    }
  }
}

// ===== Tubos =====
function crearTubo(x) {
  const cfg = NIVELES[nivelPorPuntaje(tubosCreados)];
  const h = cfg.hueco;
  const margen = 60;
  const minCentro = margen + h / 2;
  const maxCentro = H - ALTURA_SUELO - margen - h / 2;

  let centro;
  if (ultimoCentro === null) {
    centro = (minCentro + maxCentro) / 2 + (Math.random() - 0.5) * 40;
  } else {
    // Limitamos cuánto cambia la altura para que siempre se pueda pasar
    centro = ultimoCentro + (Math.random() * 2 - 1) * cfg.saltoMax;
  }
  centro = Math.max(minCentro, Math.min(maxCentro, centro));
  ultimoCentro = centro;

  tubosCreados++;
  tubos.push({ x: x, arriba: centro - h / 2, hueco: h, pasado: false, numero: tubosCreados });
}

// Crea tubos hasta llenar la pantalla (máximo META tubos en total)
function generarTubos() {
  while (tubosCreados < META) {
    const ultimo = tubos[tubos.length - 1];
    const sep = NIVELES[nivelPorPuntaje(tubosCreados)].separacion;
    const x = ultimo ? ultimo.x + sep : Math.min(pajaro.x + 380, W + 30);
    if (x > W + 30) break;
    crearTubo(x);
  }
}

// ===== Entrada =====
function accion() {
  if (estado === "inicio") {
    estado = "jugando";
    bannerTiempo = 2.4;
    generarTubos();
    saltar();
  } else if (estado === "jugando") {
    saltar();
  } else if (estado === "fin" && tiempoFin > 0.6) {
    reiniciar();
  } else if (estado === "victoria" && tiempoFin > 1.4) {
    reiniciar();
  }
}

function saltar() {
  pajaro.vy = FUERZA_SALTO;
  beep(520, 0.08);
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    if (!e.repeat) accion();
  }
  // Tecla F: pantalla completa del navegador
  if (e.code === "KeyF" && !e.repeat) {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }
});
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  accion();
});

// ===== Lógica =====
function guardarMejor() {
  if (puntaje > mejor) {
    mejor = puntaje;
    try {
      localStorage.setItem("flappy-mejor", String(mejor));
    } catch (e) {}
  }
}

function terminar() {
  estado = "fin";
  tiempoFin = 0;
  beep(160, 0.35, "sawtooth");
  guardarMejor();
}

function ganar() {
  estado = "victoria";
  tiempoFin = 0;
  bannerTiempo = 0;
  guardarMejor();
  sonidoVictoria();
  const colores = ["#ffd23f", "#ff6b6b", "#4ecdc4", "#a06cd5", "#ffffff", "#6bbf59"];
  confeti = [];
  for (let i = 0; i < 140; i++) {
    confeti.push({
      x: Math.random() * W,
      y: -Math.random() * H * 0.9,
      vx: (Math.random() - 0.5) * 40,
      vy: 70 + Math.random() * 110,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 5,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 8,
      f: Math.random() * 6,
      color: colores[i % colores.length],
    });
  }
}

// Qué tan oscuro debe estar el ambiente según la puntuación
function oscuridadObjetivo() {
  if (estado === "victoria") return 0;
  if (puntaje < NIVELES[1].hasta) return 0;
  if (puntaje < NIVELES[2].hasta) {
    const avance = (puntaje - NIVELES[1].hasta) / (NIVELES[2].hasta - NIVELES[1].hasta);
    return 0.35 + avance * 0.35;
  }
  const avance = (puntaje - NIVELES[2].hasta) / (NIVELES[3].hasta - NIVELES[2].hasta);
  return 0.85 + Math.min(1, avance) * 0.15;
}

function actualizar(dt) {
  tiempo += dt;

  // Ambiente: cambia poco a poco
  oscuridad += (oscuridadObjetivo() - oscuridad) * Math.min(1, dt * 1.2);
  if (bannerTiempo > 0) bannerTiempo -= dt;
  if (destello > 0) destello -= dt;

  // Nubes
  for (const n of nubes) {
    n.x -= n.vel * dt;
    if (n.x < -80) {
      n.x = W + 80;
      n.y = 40 + Math.random() * 220;
    }
  }

  // Murciélagos
  for (const m of murcielagos) {
    m.x -= m.vel * dt;
    if (m.x < -30) {
      m.x = W + 30;
      m.y = 90 + Math.random() * 230;
    }
  }

  // Relámpagos (solo en el nivel 3, y poco frecuentes)
  if (oscuridad > 0.8 && estado === "jugando") {
    proximoRelampago -= dt;
    if (proximoRelampago <= 0) {
      destello = 0.4;
      proximoRelampago = 6 + Math.random() * 7;
      setTimeout(() => beep(60, 0.7, "sawtooth", 0.1), 300);
    }
  }

  // Velocidad según el nivel (cambia suavemente)
  velocidad += (NIVELES[nivel].velocidad - velocidad) * Math.min(1, dt * 2);

  if (estado !== "fin") {
    desplazamientoSuelo = (desplazamientoSuelo + velocidad * dt) % 24;
    fondoX += velocidad * 0.3 * dt;
  }

  if (estado === "inicio") {
    // El pájaro flota arriba y abajo
    pajaro.y = (H - ALTURA_SUELO) / 2 + Math.sin(tiempo * 4) * 8;
    pajaro.angulo = 0;
    return;
  }

  if (estado === "victoria") {
    tiempoFin += dt;
    for (const t of tubos) t.x -= velocidad * dt;
    tubos = tubos.filter((t) => t.x + ANCHO_TUBO > -10);

    // El pájaro vuela tranquilo hacia el centro
    const objetivoY = (H - ALTURA_SUELO) * 0.42 + Math.sin(tiempo * 3) * 8;
    pajaro.y += (objetivoY - pajaro.y) * Math.min(1, dt * 2.5);
    pajaro.vy = 0;
    pajaro.angulo += (0 - pajaro.angulo) * Math.min(1, dt * 6);

    for (const c of confeti) {
      c.y += c.vy * dt;
      c.x += (c.vx + Math.sin(tiempo * 2 + c.f) * 25) * dt;
      c.rot += c.vr * dt;
      if (c.y > H + 20) {
        c.y = -20;
        c.x = Math.random() * W;
      }
    }
    return;
  }

  // Física del pájaro
  pajaro.vy += GRAVEDAD * dt;
  pajaro.y += pajaro.vy * dt;
  const objetivo = Math.max(-0.5, Math.min(1.3, pajaro.vy / 450));
  pajaro.angulo += (objetivo - pajaro.angulo) * Math.min(1, dt * 12);

  const sueloY = H - ALTURA_SUELO;

  if (estado === "fin") {
    tiempoFin += dt;
    if (pajaro.y + pajaro.radio > sueloY) {
      pajaro.y = sueloY - pajaro.radio;
      pajaro.vy = 0;
    }
    return;
  }

  // Techo
  if (pajaro.y - pajaro.radio < 0) {
    pajaro.y = pajaro.radio;
    pajaro.vy = 0;
  }

  // Suelo
  if (pajaro.y + pajaro.radio >= sueloY) {
    pajaro.y = sueloY - pajaro.radio;
    terminar();
    return;
  }

  // Tubos
  for (const t of tubos) {
    t.x -= velocidad * dt;

    // Colisión (radio un poco más pequeño para ser justo)
    const r = pajaro.radio - 3;
    const dentroX = pajaro.x + r > t.x && pajaro.x - r < t.x + ANCHO_TUBO;
    if (dentroX && (pajaro.y - r < t.arriba || pajaro.y + r > t.arriba + t.hueco)) {
      terminar();
      return;
    }

    // Puntos
    if (!t.pasado && t.x + ANCHO_TUBO < pajaro.x) {
      t.pasado = true;
      puntaje++;
      beep(880, 0.1, "triangle");

      // ¿Pasamos el último tubo? ¡Victoria!
      if (puntaje >= META) {
        ganar();
        return;
      }

      // ¿Subimos de nivel?
      const nuevo = nivelPorPuntaje(puntaje);
      if (nuevo !== nivel) {
        nivel = nuevo;
        bannerTiempo = 2.8;
        sonidoNivel(nuevo);
      }
    }
  }

  // Quitar tubos que salieron y crear nuevos
  tubos = tubos.filter((t) => t.x + ANCHO_TUBO > -10);
  generarTubos();
}

// ===== Dibujo: fondo =====
function dibujarLuna() {
  const a = limitar01((oscuridad - 0.25) / 0.35);
  if (a <= 0) return;
  const x = Math.min(W - 60, W * 0.75);
  const y = 130;
  const r = 34;
  const color = mezclar("#f4eed2", "#b3202b", limitar01((oscuridad - 0.5) / 0.5));

  ctx.save();
  ctx.globalAlpha = a;
  const brillo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 3);
  brillo.addColorStop(0, "rgba(255, 255, 255, 0.25)");
  brillo.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = brillo;
  ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  ctx.beginPath();
  ctx.arc(x - 11, y - 8, 7, 0, Math.PI * 2);
  ctx.arc(x + 10, y + 6, 9, 0, Math.PI * 2);
  ctx.arc(x - 3, y + 15, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function dibujarEstrellas() {
  const a = limitar01((oscuridad - 0.45) / 0.3);
  if (a <= 0) return;
  ctx.fillStyle = "#fff";
  for (const e of estrellas) {
    ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(tiempo * 2 + e.f));
    ctx.beginPath();
    ctx.arc(e.x * W, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function dibujarMurcielagos() {
  const a = limitar01((oscuridad - 0.4) / 0.3);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "#24152d";
  for (const m of murcielagos) {
    const w = Math.sin(tiempo * 16 + m.f) * 7;
    const x = m.x;
    const y = m.y + Math.sin(tiempo * 2 + m.f) * 6;
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.quadraticCurveTo(x - 9, y - 11 - w * 0.4, x - 19, y + w * 0.8);
    ctx.quadraticCurveTo(x - 10, y + 1, x - 4, y + 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.quadraticCurveTo(x + 10, y + 1, x + 19, y + w * 0.8);
    ctx.quadraticCurveTo(x + 9, y - 11 - w * 0.4, x, y - 3);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - 1, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function arbolMuerto(x, y, h, inclina) {
  const topX = x + inclina * 10;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(topX, y - h);
  ctx.stroke();

  const ramas = [
    [0.45, -1, 0.38],
    [0.62, 1, 0.34],
    [0.8, -1, 0.26],
    [0.92, 1, 0.2],
  ];
  for (const [alt, dir, largo] of ramas) {
    const bx = x + (topX - x) * alt;
    const by = y - h * alt;
    const ex = bx + dir * h * largo;
    const ey = by - h * largo * 0.8;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // ramita
    const px = bx + (ex - bx) * 0.6;
    const py = by + (ey - by) * 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dir * h * 0.12, py - h * 0.14);
    ctx.stroke();
  }
}

function dibujarArboles() {
  const a = limitar01((oscuridad - 0.45) / 0.3);
  if (a <= 0) return;
  const base = H - ALTURA_SUELO;
  const sp = 190;
  const desfase = fondoX % sp;
  const primero = Math.floor(fondoX / sp);

  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = "#0b070e";
  ctx.lineCap = "round";
  for (let i = -1; i * sp - desfase < W + 60; i++) {
    const n = Math.abs(primero + i);
    const x = i * sp - desfase + ((n * 53) % 60);
    const h = 90 + ((n * 37) % 5) * 16;
    arbolMuerto(x, base, h, (n * 13) % 3 - 1);
  }
  ctx.restore();
}

function dibujarNiebla() {
  if (oscuridad < 0.1) return;
  const sueloY = H - ALTURA_SUELO;
  const niebla = ctx.createLinearGradient(0, sueloY - 150, 0, sueloY);
  niebla.addColorStop(0, "rgba(170, 150, 185, 0)");
  niebla.addColorStop(1, `rgba(170, 150, 185, ${0.3 * oscuridad})`);
  ctx.fillStyle = niebla;
  ctx.fillRect(0, sueloY - 150, W, 150);
}

function dibujarFondo() {
  const cielo = ctx.createLinearGradient(0, 0, 0, H - ALTURA_SUELO);
  cielo.addColorStop(0, col("cieloArriba"));
  cielo.addColorStop(1, col("cieloAbajo"));
  ctx.fillStyle = cielo;
  ctx.fillRect(0, 0, W, H);

  dibujarEstrellas();
  dibujarLuna();

  // Nubes
  ctx.fillStyle = col("nubes");
  ctx.globalAlpha = 0.75;
  for (const n of nubes) {
    const s = n.escala;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 16 * s, 0, Math.PI * 2);
    ctx.arc(n.x + 18 * s, n.y - 8 * s, 20 * s, 0, Math.PI * 2);
    ctx.arc(n.x + 40 * s, n.y, 15 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  dibujarMurcielagos();

  // Colinas lejanas
  ctx.fillStyle = col("colinas");
  ctx.beginPath();
  ctx.moveTo(0, H - ALTURA_SUELO);
  for (let x = 0; x <= W + 10; x += 10) {
    ctx.lineTo(x, H - ALTURA_SUELO - 30 - Math.sin((x + fondoX * 0.5) / 55) * 14);
  }
  ctx.lineTo(W + 10, H - ALTURA_SUELO);
  ctx.closePath();
  ctx.fill();

  dibujarArboles();
  dibujarNiebla();
}

// ===== Dibujo: tubos, suelo, pájaro =====
function dibujarTubo(t) {
  const sueloY = H - ALTURA_SUELO;
  const abajoY = t.arriba + t.hueco;
  const alturaCap = 22;

  function cuerpo(y, alto) {
    ctx.fillStyle = col("tuboCuerpo");
    ctx.fillRect(t.x, y, ANCHO_TUBO, alto);
    ctx.fillStyle = col("tuboLuz");
    ctx.fillRect(t.x + 6, y, 10, alto);
    ctx.fillStyle = col("tuboSombra");
    ctx.fillRect(t.x + ANCHO_TUBO - 8, y, 8, alto);
  }
  function tapa(y) {
    ctx.fillStyle = col("tuboCuerpo");
    ctx.fillRect(t.x - 4, y, ANCHO_TUBO + 8, alturaCap);
    ctx.fillStyle = col("tuboLuz");
    ctx.fillRect(t.x, y, 10, alturaCap);
    ctx.strokeStyle = col("tuboBorde");
    ctx.lineWidth = 3;
    ctx.strokeRect(t.x - 4, y, ANCHO_TUBO + 8, alturaCap);
  }

  // Tubo de arriba
  cuerpo(0, t.arriba);
  tapa(t.arriba - alturaCap);
  // Tubo de abajo
  cuerpo(abajoY, sueloY - abajoY);
  tapa(abajoY);

  // Goteo de sangre en el ambiente más tétrico
  const sangre = limitar01((oscuridad - 0.6) / 0.3);
  if (sangre > 0) {
    ctx.fillStyle = `rgba(140, 15, 27, ${sangre})`;
    for (let i = 0; i < 3; i++) {
      const gx = t.x + 6 + i * 22;
      const largo = 6 + ((t.numero * 7 + i * 13) % 18);
      ctx.fillRect(gx, t.arriba, 4, largo);
      ctx.beginPath();
      ctx.arc(gx + 2, t.arriba + largo, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function dibujarSuelo() {
  const y = H - ALTURA_SUELO;
  ctx.fillStyle = col("suelo");
  ctx.fillRect(0, y, W, ALTURA_SUELO);
  ctx.fillStyle = col("pasto");
  ctx.fillRect(0, y, W, 14);
  ctx.fillStyle = col("pastoOscuro");
  for (let x = -24 + -desplazamientoSuelo; x < W; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 12, y);
    ctx.lineTo(x + 24, y + 14);
    ctx.lineTo(x + 12, y + 14);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = col("sueloLinea");
  ctx.fillRect(0, y + 14, W, 4);
}

function dibujarPajaro() {
  ctx.save();
  ctx.translate(pajaro.x, pajaro.y);
  ctx.rotate(pajaro.angulo);

  // Cuerpo
  ctx.fillStyle = "#ffcf3d";
  ctx.strokeStyle = "#5a3b12";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 17, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Ala (aletea)
  const aleteo = estado === "fin" ? 0.3 : Math.sin(tiempo * 22);
  ctx.fillStyle = "#f2a63a";
  ctx.beginPath();
  ctx.ellipse(-5, 3 + aleteo * 3, 9, 6, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Ojo
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(7, -5, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(9, -5, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Pico
  ctx.fillStyle = "#e8553d";
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(25, 3);
  ctx.lineTo(14, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// ===== Dibujo: efectos y textos =====
function dibujarConfeti() {
  for (const c of confeti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }
}

function dibujarDestello() {
  if (destello <= 0) return;
  const a = 0.28 * (destello / 0.4) * (Math.sin(destello * 40) > -0.3 ? 1 : 0.4);
  ctx.fillStyle = `rgba(220, 225, 255, ${a})`;
  ctx.fillRect(0, 0, W, H);
}

function dibujarViñeta() {
  if (oscuridad < 0.05) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, "rgba(0, 0, 0, 0)");
  g.addColorStop(1, `rgba(0, 0, 0, ${0.7 * oscuridad})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function texto(str, x, y, tam, color = "#fff") {
  ctx.font = `bold ${tam}px "Trebuchet MS", Verdana, sans-serif`;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(4, tam / 6);
  ctx.strokeStyle = "#1f2a44";
  ctx.strokeText(str, x, y, W - 24);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y, W - 24);
}

function dibujarInterfaz() {
  if (estado === "jugando") {
    texto(String(puntaje), W / 2, 80, 52);
    texto("Nivel " + nivel + " de 3", W / 2, 108, 16);

    if (bannerTiempo > 0) {
      const colores = { 1: "#ffffff", 2: "#ff9a4d", 3: "#ff3b4a" };
      ctx.save();
      ctx.globalAlpha = Math.min(1, bannerTiempo / 0.6);
      texto("NIVEL " + nivel, W / 2, 250, 46, colores[nivel]);
      texto(SUBTITULOS[nivel], W / 2, 288, 20);
      ctx.restore();
    }
  }

  if (estado === "inicio") {
    texto("Flappy Bird", W / 2, 150, 46, "#ffcf3d");
    texto("Toca o presiona espacio", W / 2, 400, 22);
    texto("para empezar", W / 2, 430, 22);
    texto("3 niveles · meta: " + META + " puntos", W / 2, 470, 18);
    if (mejor > 0) texto("Mejor: " + mejor, W / 2, 505, 20, "#ffcf3d");
    texto("F = pantalla completa", W / 2, 550, 16, "#f6d5a8");
  }

  if (estado === "fin") {
    ctx.fillStyle = "rgba(31, 42, 68, 0.55)";
    ctx.fillRect(0, 0, W, H);

    texto("Fin del juego", W / 2, 190, 40, "#e8553d");

    ctx.fillStyle = "#f6d5a8";
    ctx.strokeStyle = "#1f2a44";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(W / 2 - 110, 225, 220, 120, 12);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 20px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = "#1f2a44";
    ctx.fillText("Puntos", W / 2, 260);
    ctx.fillText("Mejor", W / 2, 312);
    ctx.font = 'bold 30px "Trebuchet MS", Verdana, sans-serif';
    ctx.fillText(String(puntaje), W / 2, 292);
    ctx.fillText(String(mejor), W / 2, 340);

    if (tiempoFin > 0.6) {
      texto("Toca para jugar de nuevo", W / 2, 400, 20);
    }
  }

  if (estado === "victoria") {
    texto("¡Lo hemos logrado!", W / 2, 190, 42, "#ffd23f");
    texto("Completaste los 3 niveles", W / 2, 235, 20);
    texto("Puntos: " + puntaje, W / 2, 275, 26);
    if (tiempoFin > 1.4) {
      texto("Toca para jugar de nuevo", W / 2, 420, 20);
    }
  }
}

function dibujar() {
  dibujarFondo();
  for (const t of tubos) dibujarTubo(t);
  dibujarSuelo();
  dibujarPajaro();
  dibujarConfeti();
  dibujarDestello();
  dibujarViñeta();
  dibujarInterfaz();
}

// ===== Bucle principal =====
let ultimoTiempo = performance.now();
function bucle(ahora) {
  const dt = Math.min(0.033, (ahora - ultimoTiempo) / 1000);
  ultimoTiempo = ahora;
  actualizar(dt);
  dibujar();
  requestAnimationFrame(bucle);
}

window.addEventListener("resize", ajustarPantalla);
reiniciar();
ajustarPantalla();
requestAnimationFrame(bucle);
