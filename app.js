import { firebaseConfig } from './firebase-config.js';
import { initializeApp }                              from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                                                      from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, deleteDoc,
         onSnapshot, query, orderBy, where, serverTimestamp }
                                                      from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

// ===== FIREBASE INIT =====
const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

// ===== CONSTANTS =====
const BIRTH      = new Date('2026-04-02');
const MAX_PHOTOS = 6;
const MAX_PX     = 720;
const QUALITY    = 0.70;
const MAX_REC_S  = 90; // seconds

const PHRASES = [
  'Cada momento é pequeno demais para ser esquecido.',
  'Ele crescerá, mas estas memórias ficarão para sempre.',
  'O amor que você sente hoje, ele vai ler um dia.',
  'Registre o cheirinho, o sorriso, o peso nos seus braços.',
  'Os dias são longos, mas os anos são curtos.',
  'Cada foto é um bilhete para o futuro.',
];

const SUGGESTIONS = [
  '🌅 Como foi a manhã de hoje com o Elias?',
  '😴 Descreva como ele dormiu esta noite.',
  '😊 Ele fez alguma coisa fofa que te surpreendeu?',
  '🍼 Como foi a amamentação hoje?',
  '🧸 Qual objeto chamou a atenção dele?',
  '💪 Algum novo movimento ou habilidade?',
  '👨‍👩‍👦 Como foi o dia em família?',
  '🩺 Alguma novidade de saúde ou desenvolvimento?',
];

// ===== STATE =====
let currentUser   = null;
let memories      = [];
let currentMemId  = null;
let unsubMemories = null;
let selectedPhotos = [];  // { dataUrl, file }[]
let selectedAudio  = null; // { dataUrl, mimeType }
let mediaRecorder  = null;
let recInterval    = null;
let recSeconds     = 0;
let lightboxPhotos = [];
let lightboxIndex  = 0;

// ===== AUTH =====
onAuthStateChanged(auth, user => {
  if (user) { currentUser = user; showApp(user); }
  else      { currentUser = null; showLogin(); }
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch { showToast('Erro ao entrar. Tente novamente.'); }
});

async function signOutUser() {
  hideUserMenu();
  await signOut(auth);
}

function showLogin() {
  hide('screen-loading');
  hide('screen-app');
  show('screen-login');
  if (unsubMemories) { unsubMemories(); unsubMemories = null; }
}

function showApp(user) {
  hide('screen-loading');
  hide('screen-login');
  show('screen-app');
  el('user-avatar').src        = user.photoURL || '';
  el('user-menu-avatar').src   = user.photoURL || '';
  el('user-menu-name').textContent  = user.displayName || '';
  el('user-menu-email').textContent = user.email || '';
  subscribeMemories();
  loadCoverPhoto();
  updateAge();
  setInterval(updateAge, 60000);
  el('home-phrase').textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  renderSuggestions();
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

// ===== USER MENU =====
function showUserMenu() { show('user-menu'); show('user-menu-backdrop'); }
function hideUserMenu()  { hide('user-menu'); hide('user-menu-backdrop'); }
window.showUserMenu = showUserMenu;
window.hideUserMenu = hideUserMenu;
window.signOutUser  = signOutUser;

// ===== FIRESTORE =====
function subscribeMemories() {
  if (unsubMemories) unsubMemories();
  const q = query(collection(db, 'memories'), where('uid', '==', currentUser.uid), orderBy('date', 'desc'));
  unsubMemories = onSnapshot(q, snap => {
    memories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const p = currentPage();
    if (p === 'home')    renderHome();
    if (p === 'album')   renderAlbum();
    if (p === 'gallery') renderGallery();
  });
}

// ===== ROUTING =====
function handleRoute() {
  const hash = location.hash.replace('#', '') || 'home';
  const [page, id] = hash.split('/').filter(Boolean);
  showPage(page || 'home');
  if (page === 'detail' && id) { currentMemId = id; renderDetail(id); }
  if (page === 'home')    renderHome();
  if (page === 'album')   renderAlbum();
  if (page === 'gallery') renderGallery();
  if (page === 'add')     initAddForm();
  updateNavTabs(page || 'home');
}

function navigate(page, id) { location.hash = id ? `${page}/${id}` : page; }
window.navigate = navigate;

function currentPage() { return (location.hash.replace('#','') || 'home').split('/')[0]; }

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  el(`page-${name}`)?.classList.remove('hidden');
}

function updateNavTabs(page) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  const titles = { home:'Álbum do Elias', album:'Álbum', gallery:'Galeria', reminders:'Lembretes', add:'Nova Memória', detail:'Memória' };
  el('top-bar-title').textContent = titles[page] || 'Álbum do Elias';
}

// ===== HOME =====
function renderHome() {
  renderStats();
  const list   = el('home-recent-list');
  const recent = memories.slice(0, 3);
  if (!recent.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📷</span><h3>Sem memórias ainda</h3><p>Toque em ＋ para criar a primeira</p></div>`;
    return;
  }
  list.innerHTML = recent.map(m => {
    const thumb = m.photos?.[0]
      ? `<img class="mini-card-img" src="${m.photos[0]}" loading="lazy">`
      : `<div class="mini-card-no-photo">${catIcon(m.category)}</div>`;
    return `<div class="mini-card" onclick="navigate('detail','${m.id}')">
      ${thumb}
      <div class="mini-card-body">
        <div class="mini-card-title">${esc(m.title)}</div>
        <div class="mini-card-date">${fmtDate(m.date)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderStats() {
  const total  = memories.length;
  const photos = memories.reduce((s, m) => s + (m.photos?.length || 0), 0);
  const last   = daysSinceLast();
  el('home-stats').innerHTML = `
    <div class="home-stat"><div class="home-stat-num">${total}</div><div class="home-stat-label">Memórias</div></div>
    <div class="home-stat"><div class="home-stat-num">${photos}</div><div class="home-stat-label">Fotos</div></div>
    <div class="home-stat"><div class="home-stat-num">${last}</div><div class="home-stat-label">Dias desde<br>a última</div></div>`;
}

function daysSinceLast() {
  if (!memories.length) return '—';
  const d = memories[0].date?.toDate ? memories[0].date.toDate() : new Date(memories[0].date);
  return Math.floor((Date.now() - d) / 86400000);
}

function updateAge() {
  const el2 = el('home-age');
  if (!el2) return;
  const days   = Math.floor((Date.now() - BIRTH) / 86400000);
  const weeks  = Math.floor(days / 7);
  const months = Math.floor(days / 30.44);
  let txt;
  if (days < 7)       txt = `${days} dia${days !== 1 ? 's' : ''} de vida`;
  else if (days < 60) txt = `${weeks} semana${weeks !== 1 ? 's' : ''} (${days} dias)`;
  else                txt = `${months} ${months === 1 ? 'mês' : 'meses'} de vida`;
  el2.textContent = `✦ ${txt}`;
}

// ===== COVER PHOTO =====
async function loadCoverPhoto() {
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists() && snap.data().coverPhoto) applyCover(snap.data().coverPhoto);
  } catch (_) {}
}

function applyCover(dataUrl) {
  const cover = el('home-cover');
  cover.style.backgroundImage    = `url(${dataUrl})`;
  cover.style.backgroundSize     = 'cover';
  cover.style.backgroundPosition = 'center';
}

function triggerCoverUpload() { el('cover-upload-input').click(); }

async function uploadCoverPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  showToast('Processando capa...');
  const dataUrl = await compressImage(file, 1024, 0.78);
  applyCover(dataUrl);
  await setDoc(doc(db, 'users', currentUser.uid), { coverPhoto: dataUrl }, { merge: true });
  showToast('Capa atualizada ✓');
}

window.triggerCoverUpload = triggerCoverUpload;
window.uploadCoverPhoto   = uploadCoverPhoto;

// ===== ALBUM =====
let albumFilter = 'all';

function renderAlbum() {
  const list     = el('album-list');
  const filtered = albumFilter === 'all' ? memories : memories.filter(m => m.category === albumFilter);
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📖</span><h3>Nenhuma memória${albumFilter !== 'all' ? ' aqui' : ''}</h3><p>Toque em ＋ para criar</p></div>`;
    return;
  }
  list.innerHTML = filtered.map(m => {
    const imgHtml = m.photos?.[0] ? `<img class="memory-card-img" src="${m.photos[0]}" loading="lazy">` : '';
    const excerpt = m.comment ? esc(m.comment).slice(0, 100) + (m.comment.length > 100 ? '…' : '') : '';
    return `<div class="memory-card" onclick="navigate('detail','${m.id}')">
      ${imgHtml}
      <div class="memory-card-body">
        <div class="memory-card-meta">
          <span class="memory-card-date">${fmtDate(m.date)}</span>
          <div class="memory-card-badges">
            <span class="cat-badge ${m.category}">${m.category}</span>
            ${m.audioData ? '<span class="audio-badge">🎙️</span>' : ''}
          </div>
        </div>
        <h3 class="memory-card-title">${esc(m.title)}</h3>
        ${excerpt ? `<p class="memory-card-excerpt">${excerpt}</p>` : ''}
      </div>
    </div>`;
  }).join('');
}

el('album-filters').addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  albumFilter = chip.dataset.cat;
  renderAlbum();
});

// ===== GALLERY =====
function renderGallery() {
  const grid      = el('gallery-grid');
  const allPhotos = [];
  memories.forEach(m => (m.photos || []).forEach(url => allPhotos.push({ url, title: m.title, date: m.date, memId: m.id })));
  if (!allPhotos.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="empty-state-icon">🖼️</span><h3>Nenhuma foto ainda</h3></div>`;
    return;
  }
  grid.innerHTML = allPhotos.map((p, i) =>
    `<div class="gallery-item" onclick="openLightbox(${i})"><img src="${p.url}" alt="${esc(p.title)}" loading="lazy"></div>`
  ).join('');
  lightboxPhotos = allPhotos;
}

// ===== LIGHTBOX =====
function openLightbox(i) {
  lightboxIndex = i;
  renderLightboxImg();
  show('lightbox');
}
function renderLightboxImg() {
  const p = lightboxPhotos[lightboxIndex];
  el('lightbox-img').src = p.url;
  el('lightbox-caption').textContent = `${p.title} — ${fmtDate(p.date)}`;
}
function lightboxNav(dir) {
  lightboxIndex = (lightboxIndex + dir + lightboxPhotos.length) % lightboxPhotos.length;
  renderLightboxImg();
}
function closeLightbox(e) {
  if (!e || e.target === el('lightbox') || e.target.classList.contains('lightbox-close')) hide('lightbox');
}
window.openLightbox  = openLightbox;
window.lightboxNav   = lightboxNav;
window.closeLightbox = closeLightbox;

// ===== ADD FORM =====
function initAddForm() {
  selectedPhotos = [];
  selectedAudio  = null;
  el('add-form').reset();
  el('photo-previews').innerHTML = '';
  el('audio-preview').innerHTML  = '';
  hide('audio-preview');
  hide('rec-timer');
  el('btn-record').classList.remove('recording');
  el('rec-label').textContent = 'Gravar';
  el('rec-icon').textContent  = '🎙️';
  const now = new Date();
  el('f-date').value = toDateVal(now);
  el('f-time').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function onPhotosSelected(e) {
  const files = Array.from(e.target.files);
  if (selectedPhotos.length + files.length > MAX_PHOTOS) {
    showToast(`Máximo de ${MAX_PHOTOS} fotos por memória`); return;
  }
  files.forEach(async f => {
    const dataUrl = await compressImage(f, MAX_PX, QUALITY);
    selectedPhotos.push(dataUrl);
    addPhotoPreview(dataUrl, selectedPhotos.length - 1);
  });
  e.target.value = '';
}

function addPhotoPreview(src, index) {
  const div = document.createElement('div');
  div.className = `photo-preview-item`;
  div.id = `pprev-${index}`;
  div.innerHTML = `<img src="${src}" alt=""><button type="button" class="photo-preview-remove" onclick="removePhoto(${index})">✕</button>`;
  el('photo-previews').appendChild(div);
}

function removePhoto(index) {
  selectedPhotos[index] = null;
  el(`pprev-${index}`)?.remove();
}

window.onPhotosSelected = onPhotosSelected;
window.removePhoto      = removePhoto;

// ===== AUDIO =====
function onAudioFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    selectedAudio = { dataUrl: ev.target.result, mimeType: file.type };
    showAudioPreview(selectedAudio.dataUrl);
  };
  reader.readAsDataURL(file);
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
  else await startRecording();
}

async function startRecording() {
  try {
    const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    mediaRecorder  = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks   = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob   = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onload = ev => {
        selectedAudio = { dataUrl: ev.target.result, mimeType: blob.type };
        showAudioPreview(selectedAudio.dataUrl);
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start(200);
    recSeconds = 0;
    el('btn-record').classList.add('recording');
    el('rec-label').textContent = 'Parar';
    el('rec-icon').textContent  = '⏹';
    show('rec-timer');
    recInterval = setInterval(() => {
      recSeconds++;
      el('rec-time').textContent = `${Math.floor(recSeconds/60)}:${pad(recSeconds%60)}`;
      if (recSeconds >= MAX_REC_S) stopRecording();
    }, 1000);
  } catch { showToast('Microfone não disponível'); }
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
  clearInterval(recInterval);
  el('btn-record').classList.remove('recording');
  el('rec-label').textContent = 'Gravar';
  el('rec-icon').textContent  = '🎙️';
  hide('rec-timer');
}

function showAudioPreview(dataUrl) {
  el('audio-preview').innerHTML = `<audio controls src="${dataUrl}" style="width:100%;border-radius:8px"></audio>`;
  show('audio-preview');
}

window.toggleRecording     = toggleRecording;
window.onAudioFileSelected = onAudioFileSelected;

// ===== SAVE MEMORY =====
async function saveMemory(e) {
  e.preventDefault();
  if (!currentUser) return;
  const btn = el('btn-save');
  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';
  try {
    const dateVal = el('f-date').value;
    const timeVal = el('f-time').value || '00:00';
    const title   = el('f-title').value.trim();
    const cat     = document.querySelector('input[name="cat"]:checked')?.value || 'Cotidiano';
    const comment = el('f-comment').value.trim();
    const photos  = selectedPhotos.filter(Boolean);

    await addDoc(collection(db, 'memories'), {
      uid: currentUser.uid,
      title, category: cat, comment,
      photos,
      audioData: selectedAudio?.dataUrl || null,
      date: new Date(`${dateVal}T${timeVal}`),
      createdAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'users', currentUser.uid), { lastMemoryAt: serverTimestamp() }, { merge: true });
    showHeartAnimation();
    showToast('Memória salva com carinho ❤️');
    navigate('album');
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar com carinho ❤️';
  }
}
window.saveMemory = saveMemory;

// ===== DETAIL =====
function renderDetail(id) {
  const m  = memories.find(x => x.id === id);
  const ct = el('detail-content');
  if (!m) { ct.innerHTML = '<p style="padding:20px;color:#999">Não encontrado.</p>'; return; }

  const photos = m.photos || [];
  const carousel = photos.length
    ? `<div class="photo-carousel" id="car-${id}">
        ${photos.map((p,i) => `<div class="carousel-slide"><img src="${p}" onclick="openDetailLightbox('${id}',${i})"></div>`).join('')}
      </div>
      ${photos.length > 1 ? `<div class="carousel-dots">${photos.map((_,i) => `<button class="carousel-dot ${i===0?'active':''}" onclick="carouselGo('${id}',${i})"></button>`).join('')}</div>` : ''}`
    : '';

  ct.innerHTML = `
    ${carousel}
    <div class="detail-body">
      <p class="detail-date">${fmtDateLong(m.date)}</p>
      <h1 class="detail-title">${esc(m.title)}</h1>
      <div class="detail-badges"><span class="cat-badge ${m.category}">${m.category}</span></div>
      ${m.audioData ? `<div class="detail-audio"><audio controls src="${m.audioData}" style="width:100%"></audio></div>` : ''}
      ${m.comment ? `<hr class="detail-divider"><p class="detail-comment">${esc(m.comment)}</p>` : ''}
    </div>`;

  if (photos.length > 1) {
    const c = el(`car-${id}`);
    c.addEventListener('scroll', () => {
      const idx = Math.round(c.scrollLeft / c.offsetWidth);
      document.querySelectorAll('.carousel-dot').forEach((d,i) => d.classList.toggle('active', i === idx));
    });
  }
  lightboxPhotos = photos.map(url => ({ url, title: m.title, date: m.date }));
}

function carouselGo(id, idx) {
  const c = el(`car-${id}`);
  if (c) c.scrollTo({ left: idx * c.offsetWidth, behavior: 'smooth' });
}

function openDetailLightbox(id, idx) {
  lightboxIndex = idx;
  renderLightboxImg();
  show('lightbox');
}

window.carouselGo         = carouselGo;
window.openDetailLightbox = openDetailLightbox;

async function deleteMemory() {
  if (!currentMemId || !confirm('Apagar esta memória? Não pode ser desfeito.')) return;
  try {
    await deleteDoc(doc(db, 'memories', currentMemId));
    navigate('album');
    showToast('Memória apagada');
  } catch { showToast('Erro ao apagar'); }
}
window.deleteMemory = deleteMemory;

// ===== SHARE =====
async function shareMemory() {
  const m = memories.find(x => x.id === currentMemId);
  if (!m) return;
  try {
    const target = el('share-target');
    target.classList.remove('hidden');
    target.style.cssText = 'position:fixed;top:0;left:0;width:375px;background:#FAF7F2;padding:24px;font-family:Georgia,serif;z-index:-1;';
    target.innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <div style="font-size:22px;color:#B8922A;margin-bottom:10px">✦ Álbum do Elias</div>
        <h2 style="font-size:22px;font-style:italic;color:#2C1E14;margin-bottom:6px">${esc(m.title)}</h2>
        <p style="font-size:13px;color:#A08878">${fmtDateLong(m.date)}</p>
        ${m.photos?.[0] ? `<img src="${m.photos[0]}" style="width:100%;max-height:260px;object-fit:contain;border-radius:12px;margin-top:14px;background:#F5EDE0">` : ''}
        ${m.comment ? `<p style="font-size:14px;color:#6B5540;margin-top:14px;line-height:1.7;text-align:left">${esc(m.comment)}</p>` : ''}
        <p style="font-size:11px;color:#A08878;margin-top:16px">💙 nasceu em 2 de abril de 2026</p>
      </div>`;

    const canvas = await window.html2canvas(target, { useCORS: true, scale: 2, backgroundColor: '#FAF7F2' });
    target.classList.add('hidden');

    canvas.toBlob(async blob => {
      const file = new File([blob], 'memoria-elias.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: m.title });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'memoria-elias.png';
        a.click();
      }
    });
  } catch { showToast('Erro ao compartilhar'); }
}
window.shareMemory = shareMemory;

// ===== REMINDERS =====
function renderSuggestions() {
  el('suggestions-list').innerHTML = [...SUGGESTIONS]
    .sort(() => 0.5 - Math.random()).slice(0, 4)
    .map(s => `<div class="suggestion-item">${s}</div>`).join('');
}

async function saveReminders() {
  const days = parseInt(el('r-days').value);
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { showToast('Permissão negada'); return; }
  }
  localStorage.setItem('reminder_days',    days);
  localStorage.setItem('reminder_enabled', '1');
  showToast(`Lembrete a cada ${days} dia${days > 1 ? 's' : ''} ativado ✓`);
  checkReminder();
}

function checkReminder() {
  if (!localStorage.getItem('reminder_enabled')) return;
  const days = parseInt(localStorage.getItem('reminder_days') || '2');
  const last = daysSinceLast();
  if (typeof last === 'number' && last >= days && Notification.permission === 'granted') {
    new Notification('Álbum do Elias 🌙', {
      body: `Faz ${last} dia${last !== 1 ? 's' : ''} desde a última memória — registre algo hoje!`,
    });
  }
}
window.saveReminders = saveReminders;

// ===== IMAGE COMPRESSION =====
function compressImage(file, maxPx, quality) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else       { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = rej;
    img.src = url;
  });
}

// ===== HEART ANIMATION =====
function showHeartAnimation() {
  const d = document.createElement('div');
  d.className = 'heart-anim';
  d.innerHTML = '<span>❤️</span>';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 900);
}

// ===== TOAST =====
function showToast(msg, ms = 3000) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), ms);
}

// ===== UTILS =====
function el(id) { return document.getElementById(id); }
function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }
function pad(n) { return String(n).padStart(2, '0'); }

function fmtDate(val) {
  if (!val) return '';
  const d = val?.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtDateLong(val) {
  if (!val) return '';
  const d = val?.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
function toDateVal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function catIcon(cat) {
  return { Cotidiano:'☀️', Família:'👨‍👩‍👦', Passeio:'🌳', Consulta:'🩺', Soninho:'🌙', Especial:'✦' }[cat] || '📸';
}
