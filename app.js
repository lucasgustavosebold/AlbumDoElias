import { firebaseConfig } from './firebase-config.js';
import { initializeApp }                              from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                                                      from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, addDoc, deleteDoc, getDoc,
         onSnapshot, query, orderBy, where, serverTimestamp, updateDoc }
                                                      from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject }
                                                      from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js';

// ===== FIREBASE INIT =====
const fbApp   = initializeApp(firebaseConfig);
const auth    = getAuth(fbApp);
const db      = getFirestore(fbApp);
const storage = getStorage(fbApp);

// ===== STATE =====
const BIRTH = new Date('2026-04-02');
let currentUser   = null;
let memories      = [];
let currentMemId  = null;
let unsubMemories = null;
let selectedPhotos = [];   // File[]
let selectedAudio  = null; // { blob, url, type }
let mediaRecorder  = null;
let recInterval    = null;
let recSeconds     = 0;
let lightboxPhotos = [];
let lightboxIndex  = 0;

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
  '🍼 Como foi a amamentação / alimentação hoje?',
  '🧸 Qual brinquedo ou objeto chamou a atenção dele?',
  '💪 Algum novo movimento ou habilidade que ele demonstrou?',
  '👨‍👩‍👦 Como foi o dia em família hoje?',
  '🩺 Alguma novidade de saúde ou desenvolvimento?',
];

// ===== AUTH =====
onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    showApp(user);
  } else {
    currentUser = null;
    showLogin();
  }
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    showToast('Erro ao entrar. Tente novamente.');
  }
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
  document.getElementById('user-avatar').src = user.photoURL || '';
  document.getElementById('user-menu-avatar').src = user.photoURL || '';
  document.getElementById('user-menu-name').textContent = user.displayName || '';
  document.getElementById('user-menu-email').textContent = user.email || '';
  subscribeMemories();
  loadCoverPhoto();
  setInterval(updateAge, 60000);
  updateAge();
  document.getElementById('home-phrase').textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  renderSuggestions();
  checkReminder();
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

// ===== USER MENU =====
function showUserMenu() {
  show('user-menu');
  show('user-menu-backdrop');
}
function hideUserMenu() {
  hide('user-menu');
  hide('user-menu-backdrop');
}
window.showUserMenu  = showUserMenu;
window.hideUserMenu  = hideUserMenu;
window.signOutUser   = signOutUser;

// ===== FIRESTORE =====
function subscribeMemories() {
  if (unsubMemories) unsubMemories();
  const q = query(
    collection(db, 'memories'),
    where('uid', '==', currentUser.uid),
    orderBy('date', 'desc')
  );
  unsubMemories = onSnapshot(q, snap => {
    memories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const page = currentPage();
    if (page === 'home')    renderHome();
    if (page === 'album')   renderAlbum();
    if (page === 'gallery') renderGallery();
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

function currentPage() {
  const h = location.hash.replace('#', '') || 'home';
  return h.split('/')[0];
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById(`page-${name}`);
  if (el) el.classList.remove('hidden');
}

function updateNavTabs(page) {
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.page === page);
  });
  const title = { home: 'Álbum do Elias', album: 'Álbum', gallery: 'Galeria', reminders: 'Lembretes', add: 'Nova Memória', detail: 'Memória' };
  document.getElementById('top-bar-title').textContent = title[page] || 'Álbum do Elias';
}

// ===== HOME =====
function renderHome() {
  renderStats();
  const list  = document.getElementById('home-recent-list');
  const recent = memories.slice(0, 3);
  if (!recent.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📷</span><h3>Sem memórias ainda</h3><p>Toque em ＋ para criar a primeira</p></div>`;
    return;
  }
  list.innerHTML = recent.map(m => {
    const thumb = m.photos?.[0] ? `<img class="mini-card-img" src="${m.photos[0]}" loading="lazy">` : `<div class="mini-card-no-photo">${catIcon(m.category)}</div>`;
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
  const el = document.getElementById('home-stats');
  const total = memories.length;
  const photos = memories.reduce((s, m) => s + (m.photos?.length || 0), 0);
  el.innerHTML = `
    <div class="home-stat"><div class="home-stat-num">${total}</div><div class="home-stat-label">Memórias</div></div>
    <div class="home-stat"><div class="home-stat-num">${photos}</div><div class="home-stat-label">Fotos</div></div>
    <div class="home-stat"><div class="home-stat-num">${daysSinceLast()}</div><div class="home-stat-label">Dias desde a última</div></div>`;
}

function daysSinceLast() {
  if (!memories.length) return '—';
  const last = memories[0];
  const d = last.date?.toDate ? last.date.toDate() : new Date(last.date);
  return Math.floor((Date.now() - d) / 86400000);
}

function updateAge() {
  const el = document.getElementById('home-age');
  if (!el) return;
  const days   = Math.floor((Date.now() - BIRTH) / 86400000);
  const weeks  = Math.floor(days / 7);
  const months = Math.floor(days / 30.44);
  let txt;
  if (days < 7)       txt = `${days} dia${days !== 1 ? 's' : ''} de vida`;
  else if (days < 60) txt = `${weeks} semana${weeks !== 1 ? 's' : ''} (${days} dias)`;
  else                txt = `${months} ${months === 1 ? 'mês' : 'meses'} de vida`;
  el.textContent = `✦ ${txt}`;
}

// ===== COVER PHOTO =====
async function loadCoverPhoto() {
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists() && snap.data().coverPhotoUrl) {
      setCoverPhoto(snap.data().coverPhotoUrl);
    }
  } catch (_) {}
}

function setCoverPhoto(url) {
  const cover = document.getElementById('home-cover');
  cover.style.backgroundImage = `url(${url})`;
  cover.style.backgroundSize  = 'cover';
  cover.style.backgroundPosition = 'center';
}

function triggerCoverUpload() {
  document.getElementById('cover-upload-input').click();
}

async function uploadCoverPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  showToast('Enviando capa...');
  const r = ref(storage, `covers/${currentUser.uid}/cover.jpg`);
  const task = uploadBytesResumable(r, file);
  task.on('state_changed', null, () => showToast('Erro ao enviar capa'), async () => {
    const url = await getDownloadURL(task.snapshot.ref);
    setCoverPhoto(url);
    await setDoc(doc(db, 'users', currentUser.uid), { coverPhotoUrl: url }, { merge: true });
    showToast('Capa atualizada ✓');
  });
}

window.triggerCoverUpload = triggerCoverUpload;
window.uploadCoverPhoto   = uploadCoverPhoto;

// ===== ALBUM =====
let albumFilter = 'all';

function renderAlbum() {
  const list = document.getElementById('album-list');
  const filtered = albumFilter === 'all' ? memories : memories.filter(m => m.category === albumFilter);
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📖</span><h3>Nenhuma memória${albumFilter !== 'all' ? ' nessa categoria' : ''}</h3><p>Toque em ＋ para criar</p></div>`;
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
            ${m.audioUrl ? '<span class="audio-badge">🎙️</span>' : ''}
          </div>
        </div>
        <h3 class="memory-card-title">${esc(m.title)}</h3>
        ${excerpt ? `<p class="memory-card-excerpt">${excerpt}</p>` : ''}
      </div>
    </div>`;
  }).join('');
}

document.getElementById('album-filters').addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  albumFilter = chip.dataset.cat;
  renderAlbum();
});

// ===== GALLERY =====
function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  const allPhotos = [];
  memories.forEach(m => (m.photos || []).forEach(url => allPhotos.push({ url, title: m.title, date: m.date, memId: m.id })));
  if (!allPhotos.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="empty-state-icon">🖼️</span><h3>Nenhuma foto ainda</h3><p>Adicione fotos nas memórias</p></div>`;
    return;
  }
  grid.innerHTML = allPhotos.map((p, i) =>
    `<div class="gallery-item" onclick="openLightbox(${i})">
      <img src="${p.url}" alt="${esc(p.title)}" loading="lazy">
    </div>`).join('');
  lightboxPhotos = allPhotos;
}

// ===== LIGHTBOX =====
function openLightbox(i) {
  lightboxIndex = i;
  renderLightbox();
  show('lightbox');
}

function renderLightbox() {
  const p = lightboxPhotos[lightboxIndex];
  document.getElementById('lightbox-img').src = p.url;
  document.getElementById('lightbox-caption').textContent = `${p.title} — ${fmtDate(p.date)}`;
}

function lightboxNav(dir) {
  lightboxIndex = (lightboxIndex + dir + lightboxPhotos.length) % lightboxPhotos.length;
  renderLightbox();
}

function closeLightbox(e) {
  if (!e || e.target === document.getElementById('lightbox') || e.target.classList.contains('lightbox-close')) {
    hide('lightbox');
  }
}

window.openLightbox  = openLightbox;
window.lightboxNav   = lightboxNav;
window.closeLightbox = closeLightbox;

// ===== ADD FORM =====
function initAddForm() {
  selectedPhotos = [];
  selectedAudio  = null;
  document.getElementById('add-form').reset();
  document.getElementById('photo-previews').innerHTML = '';
  document.getElementById('audio-preview').innerHTML = '';
  hide('audio-preview');
  hide('rec-timer');
  document.getElementById('btn-record').classList.remove('recording');
  document.getElementById('rec-label').textContent = 'Gravar';
  document.getElementById('rec-icon').textContent = '🎙️';
  const now = new Date();
  document.getElementById('f-date').value = toDateVal(now);
  document.getElementById('f-time').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function onPhotosSelected(e) {
  const files = Array.from(e.target.files);
  files.forEach(f => {
    selectedPhotos.push(f);
    const reader = new FileReader();
    reader.onload = ev => addPhotoPreview(ev.target.result, selectedPhotos.length - 1);
    reader.readAsDataURL(f);
  });
  e.target.value = '';
}

function addPhotoPreview(src, index) {
  const container = document.getElementById('photo-previews');
  const div = document.createElement('div');
  div.className = 'photo-preview-item';
  div.id = `photo-prev-${index}`;
  div.innerHTML = `
    <img src="${src}" alt="">
    <button type="button" class="photo-preview-remove" onclick="removePhoto(${index})">✕</button>
    <div class="photo-upload-progress" id="prog-${index}">
      <div class="photo-upload-progress-bar" id="progbar-${index}" style="width:0"></div>
    </div>`;
  container.appendChild(div);
}

function removePhoto(index) {
  selectedPhotos[index] = null;
  const el = document.getElementById(`photo-prev-${index}`);
  if (el) el.remove();
}

window.onPhotosSelected = onPhotosSelected;
window.removePhoto      = removePhoto;

// ===== AUDIO RECORDING =====
function onAudioFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedAudio = { blob: file, url: URL.createObjectURL(file), type: file.type };
  showAudioPreview(selectedAudio.url);
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      selectedAudio = { blob, url: URL.createObjectURL(blob), type: blob.type };
      showAudioPreview(selectedAudio.url);
    };
    mediaRecorder.start(200);
    recSeconds = 0;
    const btn = document.getElementById('btn-record');
    btn.classList.add('recording');
    document.getElementById('rec-label').textContent = 'Parar';
    document.getElementById('rec-icon').textContent = '⏹';
    show('rec-timer');
    recInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds / 60), s = recSeconds % 60;
      document.getElementById('rec-time').textContent = `${m}:${String(s).padStart(2,'0')}`;
    }, 1000);
  } catch {
    showToast('Microfone não disponível');
  }
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
  clearInterval(recInterval);
  const btn = document.getElementById('btn-record');
  btn.classList.remove('recording');
  document.getElementById('rec-label').textContent = 'Gravar';
  document.getElementById('rec-icon').textContent = '🎙️';
  hide('rec-timer');
}

function showAudioPreview(url) {
  const el = document.getElementById('audio-preview');
  el.innerHTML = `<audio controls src="${url}" style="width:100%;border-radius:8px"></audio>`;
  show('audio-preview');
}

window.toggleRecording   = toggleRecording;
window.onAudioFileSelected = onAudioFileSelected;

// ===== SAVE MEMORY =====
async function saveMemory(e) {
  e.preventDefault();
  if (!currentUser) return;

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';

  try {
    const dateVal = document.getElementById('f-date').value;
    const timeVal = document.getElementById('f-time').value || '00:00';
    const dateObj = new Date(`${dateVal}T${timeVal}`);
    const title   = document.getElementById('f-title').value.trim();
    const cat     = document.querySelector('input[name="cat"]:checked')?.value || 'Cotidiano';
    const comment = document.getElementById('f-comment').value.trim();

    // Upload photos
    const photoUrls = [];
    const validPhotos = selectedPhotos.filter(Boolean);
    for (let i = 0; i < validPhotos.length; i++) {
      btn.textContent = `📷 Foto ${i + 1}/${validPhotos.length}...`;
      const compressed = await compressImage(validPhotos[i], 1200, 0.80);
      const blob = await fetch(compressed).then(r => r.blob());
      const r = ref(storage, `memories/${currentUser.uid}/${Date.now()}_${i}.jpg`);
      const task = uploadBytesResumable(r, blob);
      const url = await new Promise((res, rej) => {
        task.on('state_changed',
          snap => {
            const pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100);
            const bar = document.getElementById(`progbar-${selectedPhotos.indexOf(validPhotos[i])}`);
            if (bar) bar.style.width = pct + '%';
          },
          rej,
          async () => res(await getDownloadURL(task.snapshot.ref))
        );
      });
      photoUrls.push(url);
    }

    // Upload audio
    let audioUrl = null;
    if (selectedAudio) {
      btn.textContent = '🎙️ Enviando áudio...';
      const ext = selectedAudio.type.includes('mp4') ? 'mp4' : selectedAudio.type.includes('ogg') ? 'ogg' : 'webm';
      const r = ref(storage, `memories/${currentUser.uid}/${Date.now()}_audio.${ext}`);
      const task = uploadBytesResumable(r, selectedAudio.blob);
      audioUrl = await new Promise((res, rej) =>
        task.on('state_changed', null, rej, async () => res(await getDownloadURL(task.snapshot.ref)))
      );
    }

    await addDoc(collection(db, 'memories'), {
      uid: currentUser.uid,
      title, category: cat, comment,
      photos: photoUrls, audioUrl,
      date: dateObj,
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
  const m = memories.find(x => x.id === id);
  const el = document.getElementById('detail-content');
  if (!m) { el.innerHTML = '<p style="padding:20px;color:#999">Memória não encontrada.</p>'; return; }

  const photos = m.photos || [];
  const carouselHtml = photos.length
    ? `<div class="photo-carousel" id="carousel-${id}">
        ${photos.map(p => `<div class="carousel-slide"><img src="${p}" alt="${esc(m.title)}" onclick="openDetailLightbox('${id}',${photos.indexOf(p)})"></div>`).join('')}
      </div>
      ${photos.length > 1 ? `<div class="carousel-dots">${photos.map((_,i) => `<button class="carousel-dot ${i===0?'active':''}" onclick="carouselGo('${id}',${i})"></button>`).join('')}</div>` : ''}` : '';

  el.innerHTML = `
    ${carouselHtml}
    <div class="detail-body">
      <p class="detail-date">${fmtDateLong(m.date)}</p>
      <h1 class="detail-title">${esc(m.title)}</h1>
      <div class="detail-badges">
        <span class="cat-badge ${m.category}">${m.category}</span>
      </div>
      ${m.audioUrl ? `<div class="detail-audio"><audio controls src="${m.audioUrl}" style="width:100%"></audio></div>` : ''}
      ${m.comment ? `<hr class="detail-divider"><p class="detail-comment">${esc(m.comment)}</p>` : ''}
    </div>`;

  if (photos.length > 1) {
    const c = document.getElementById(`carousel-${id}`);
    c.addEventListener('scroll', () => {
      const idx = Math.round(c.scrollLeft / c.offsetWidth);
      document.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    });
  }

  lightboxPhotos = photos.map(url => ({ url, title: m.title, date: m.date }));
}

function carouselGo(id, idx) {
  const c = document.getElementById(`carousel-${id}`);
  if (c) c.scrollTo({ left: idx * c.offsetWidth, behavior: 'smooth' });
}

function openDetailLightbox(id, idx) {
  lightboxIndex = idx;
  renderLightbox();
  show('lightbox');
}

window.carouselGo         = carouselGo;
window.openDetailLightbox = openDetailLightbox;

async function deleteMemory() {
  if (!currentMemId || !confirm('Apagar esta memória? Não pode ser desfeito.')) return;
  const m = memories.find(x => x.id === currentMemId);
  try {
    for (const url of (m?.photos || [])) {
      try { await deleteObject(ref(storage, url)); } catch (_) {}
    }
    if (m?.audioUrl) {
      try { await deleteObject(ref(storage, m.audioUrl)); } catch (_) {}
    }
    await deleteDoc(doc(db, 'memories', currentMemId));
    navigate('album');
    showToast('Memória apagada');
  } catch (err) {
    showToast('Erro ao apagar');
  }
}

window.deleteMemory = deleteMemory;

// ===== SHARE =====
async function shareMemory() {
  const m = memories.find(x => x.id === currentMemId);
  if (!m) return;

  try {
    const target = document.getElementById('share-target');
    target.classList.remove('hidden');
    target.style.cssText = 'position:fixed;top:0;left:0;width:375px;background:#FAF7F2;padding:20px;font-family:Georgia,serif;';
    target.innerHTML = `
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:24px;color:#B8922A;margin-bottom:8px">✦ Álbum do Elias</div>
        <h2 style="font-size:24px;font-style:italic;color:#2C1E14;margin-bottom:6px">${esc(m.title)}</h2>
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
  document.getElementById('suggestions-list').innerHTML = SUGGESTIONS
    .sort(() => 0.5 - Math.random()).slice(0, 4)
    .map(s => `<div class="suggestion-item">${s}</div>`).join('');
}

async function saveReminders() {
  const days = parseInt(document.getElementById('r-days').value);
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { showToast('Permissão negada para notificações'); return; }
  }
  localStorage.setItem('reminder_days', days);
  localStorage.setItem('reminder_enabled', '1');
  showToast(`Lembrete a cada ${days} dia${days > 1 ? 's' : ''} ativado ✓`);
}

function checkReminder() {
  if (!localStorage.getItem('reminder_enabled')) return;
  const days = parseInt(localStorage.getItem('reminder_days') || '2');
  if (daysSinceLast() >= days && typeof daysSinceLast() === 'number' && Notification.permission === 'granted') {
    new Notification('Álbum do Elias 🌙', {
      body: `Faz ${daysSinceLast()} dia(s) desde a última memória — registre algo hoje!`,
      icon: '/favicon.ico',
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
  const div = document.createElement('div');
  div.className = 'heart-anim';
  div.innerHTML = '<span>❤️</span>';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1000);
}

// ===== TOAST =====
function showToast(msg, ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ===== HELPERS =====
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function fmtDate(val) {
  if (!val) return '';
  const d = val?.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateLong(val) {
  if (!val) return '';
  const d = val?.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function toDateVal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function catIcon(cat) {
  const icons = { Cotidiano:'☀️', Família:'👨‍👩‍👦', Passeio:'🌳', Consulta:'🩺', Soninho:'🌙', Especial:'✦' };
  return icons[cat] || '📸';
}
