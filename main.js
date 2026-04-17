// 0. DEBUG & ERROR HANDLING
window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.error("DEBUG INFO:", msg, "at line", lineNo);
    return false;
};

// 1. LOADER DISMISSAL
const loader = document.getElementById('loader');
function dismissLoader() {
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
        }, 500);
    }
}

// 1.1 CUSTOM ALERT MODAL
window.showAlert = function (title, message) {
    const alertModal = document.getElementById('alert-modal');
    const alertTitle = document.getElementById('alert-title');
    const alertMsg = document.getElementById('alert-message');

    if (alertModal && alertTitle && alertMsg) {
        alertTitle.innerText = title;
        alertMsg.innerText = message;
        alertModal.classList.add('active');
    } else {
        alert(message); // Fallback
    }
}

window.closeAlertModal = function () {
    const alertModal = document.getElementById('alert-modal');
    if (alertModal) alertModal.classList.remove('active');
}
if (document.readyState === 'complete') dismissLoader();
else window.addEventListener('load', dismissLoader);
setTimeout(dismissLoader, 1000);

// 2. SUPABASE CONFIG
const SUPABASE_URL = 'https://xjoyrjzvdfwavnvnfnvt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhqb3lyanp2ZGZ3YXZudm5mbnZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NzIxMDYsImV4cCI6MjA4NjQ0ODEwNn0.Uw0MwDvBPtRjyMCt2ZA-kMYvVmIhUPXPP52AJo4a14Y';
let supabaseClient = null;
let currentUser = null;
let pendingAfterAuth = null;

function initSupabase() {
    if (typeof window.supabase !== 'undefined') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log("Supabase initialized successfully");
    } else {
        console.error("Supabase SDK not found");
    }
}

// 3. APP STATE
let menuData = [];
let cart = [];
let activePromos = [];
let appliedCoupon = null;
let currentProduct = null;
let currentQty = 1;
let currentType = "Simple";
let currentDeliveryMethod = "delivery";
let isMasterOnline = true; // Manual override from Admin

// 3.1 STORE HOURS LOGIC
function getStoreStatus() {
    const now = new Date();
    const day = now.getDay(); // 0-6 (0 is Sunday, 4 is Thursday)
    const hour = now.getHours();

    // The store is open if:
    // A) The Master Switch is ON (Manual/Forced Open)
    // B) It is Thursday and it's between 18:00 and 00:00 (Automatic Schedule)
    const isScheduledTime = (day === 4 && hour >= 18);
    const isOpen = isMasterOnline || isScheduledTime;

    if (isOpen) {
        return { open: true };
    } else {
        let msg = "";
        if (day === 4 && hour < 18) {
            msg = "a partir de las 18:00 hs";
        } else {
            msg = "el próximo JUEVES a las 18:00 hs";
        }
        return {
            open: false,
            nextOpening: msg
        };
    }
}

// 4. INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
    initListeners();
    initAuth();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    loadMenu();
    loadActivePromos();
    fetchMasterStatus();
    initScrollButtons();

    // Initial status check
    const status = getStoreStatus();
    if (!status.open) {
        console.log("Store is currently closed.");
    }
});

async function fetchMasterStatus() {
    if (!supabaseClient) return;
    try {
        const { data } = await supabaseClient.from('configuracion').select('valor').eq('id', 'ventas_web').maybeSingle();
        if (data && data.valor) {
            const newValue = data.valor.online;
            if (isMasterOnline !== newValue) {
                isMasterOnline = newValue;
                renderMenu(menuData); // Force refresh menu buttons
            }
        }
    } catch (e) { console.error("Error fetching master status:", e); }
}

// 5. DATA LOADING
async function loadMenu() {
    if (!supabaseClient) {
        console.error("Cannot load menu: Supabase client not initialized");
        return;
    }
    try {
        const { data, error } = await supabaseClient.from('productos').select('*').eq('activo', true);
        if (error) throw error;

        menuData = data.map(p => ({
            id: p.id,
            title: p.nombre || "Producto sin nombre",
            category: p.categoria || "burgers",
            simple: parseFloat(p.precio_simple) || 0,
            doble: parseFloat(p.precio_doble) || 0,
            desc: p.descripcion || "",
            img: p.imagen_url || "burger1.png",
            destacado: p.destacado || false
        }));
        renderMenu(menuData);
        renderExtras(menuData);
    } catch (e) {
        console.error("Error loading menu:", e);
    }
}

function renderExtras(data) {
    const grid = document.getElementById('extras-grid');
    if (!grid) return;
    const items = data.filter(p => p.category === 'extras');
    if (!items.length) { grid.closest('.extras-section').style.display = 'none'; return; }
    grid.innerHTML = items.map(p => `
        <div class="extra-card">
            <div class="extra-card-img">
                <img src="${p.img}" alt="${p.title}" loading="lazy">
            </div>
            <div class="extra-card-info">
                <h3>${p.title}</h3>
                <p class="extra-card-price">$${p.simple.toLocaleString()}</p>
            </div>
            <button class="extra-add-btn" onclick="addExtraToCart('${p.id}')">+ AGREGAR</button>
        </div>
    `).join('');
}

window.addExtraToCart = (productId) => {
    const product = menuData.find(p => p.id === productId);
    if (!product) return;
    const storeStatus = getStoreStatus();
    if (!storeStatus.open || !isMasterOnline) {
        alert('El local está cerrado en este momento.');
        return;
    }
    const existing = cart.find(i => i.product_id === productId && i.type === '');
    if (existing) {
        existing.qty += 1;
        existing.total = existing.pricePerUnit * existing.qty;
    } else {
        cart.push({
            id: Date.now(),
            title: product.title,
            product_id: product.id,
            type: '',
            qty: 1,
            extras: [],
            pricePerUnit: product.simple,
            total: product.simple
        });
    }
    updateOrderBar();
    const btn = document.querySelector(`.extra-add-btn[onclick="addExtraToCart('${productId}')"]`);
    if (btn) { btn.textContent = '✓ AGREGADO'; setTimeout(() => { btn.textContent = '+ AGREGAR'; }, 1200); }
};

async function loadActivePromos() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('promociones').select('*').eq('activo', true);
        if (error) throw error;
        activePromos = data;
        console.log("Promos activas cargadas:", activePromos.length);
    } catch (e) { console.error("Error loading promos:", e); }
}

// =============================================
// AUTH ENGINE
// =============================================
async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) { currentUser = session.user; await onAuthSuccess(session.user, false); }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            await onAuthSuccess(session.user, true);
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            updateAuthUI(null);
        }
    });
}

async function onAuthSuccess(user, fromLogin) {
    updateAuthUI(user);

    let { data: cliente } = await supabaseClient.from('clientes').select('*').eq('user_id', user.id).maybeSingle();

    if (!cliente) {
        let { data: byEmail } = await supabaseClient.from('clientes').select('*').eq('email', user.email).maybeSingle();
        if (byEmail) {
            await supabaseClient.from('clientes').update({ user_id: user.id }).eq('id', byEmail.id);
            cliente = byEmail;
        }
    }

    if (cliente) {
        const fill = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
        fill('cust-name', cliente.nombre);
        fill('cust-phone', cliente.whatsapp);
        fill('cust-email', cliente.email);
        fill('cust-address', cliente.direccion);
    }

    if (fromLogin) {
        closeAuthModal();
        if (pendingAfterAuth === 'checkout') {
            pendingAfterAuth = null;
            openCheckoutModal();
        }
    }
}

function updateAuthUI(user) {
    const btn = document.getElementById('user-btn');
    const label = document.getElementById('user-btn-label');
    if (!btn || !label) return;
    if (user) {
        const name = (user.user_metadata?.nombre || user.email.split('@')[0]).toUpperCase().split(' ')[0];
        label.textContent = `HOLA, ${name}`;
        btn.classList.add('logged-in');
    } else {
        label.textContent = 'INGRESAR';
        btn.classList.remove('logged-in');
    }
}

window.handleUserBtnClick = () => {
    if (currentUser) {
        if (confirm('¿Cerrar sesión?')) supabaseClient.auth.signOut();
    } else {
        openAuthModal();
    }
};

window.openAuthModal = (fromCheckout = false) => {
    if (fromCheckout) {
        pendingAfterAuth = 'checkout';
        const sub = document.getElementById('auth-subtitle');
        if (sub) sub.textContent = 'Iniciá sesión para completar tu pedido';
    }
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeAuthModal = () => {
    const modal = document.getElementById('auth-modal');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 350);
    pendingAfterAuth = null;
};

window.switchAuthTab = (tab) => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('auth-panel-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('auth-panel-register').style.display = tab === 'register' ? 'block' : 'none';
};

function setAuthError(elId, msg, isSuccess = false) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isSuccess ? '#4CAF50' : '#CC1E27';
}

function translateAuthError(error) {
    const msg = error.message || '';
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
    if (msg.includes('Email not confirmed')) return 'Confirmá tu email antes de ingresar.';
    if (msg.includes('signups are disabled') || msg.includes('Signups not allowed')) return 'El registro está temporalmente desactivado. Contactá al administrador.';
    if (msg.includes('already been registered') || msg.includes('already registered')) return 'Ya existe una cuenta con ese email. Usá "Ingresar".';
    if (msg.includes('User already registered')) return 'Ya existe una cuenta con ese email. Usá "Ingresar".';
    if (msg.includes('only request this after')) {
        const sec = msg.match(/after (\d+) second/);
        return sec ? `Demasiados intentos. Esperá ${sec[1]} segundos e intentá de nuevo.` : 'Demasiados intentos. Esperá un momento.';
    }
    if (msg.includes('Password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
    return msg;
}

function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validatePhone(phone) { return phone.replace(/\D/g, '').length >= 8; }

window.doLogin = async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    setAuthError('auth-error-login', '');
    if (!email) { setAuthError('auth-error-login', 'Ingresá tu email.'); return; }
    if (!validateEmail(email)) { setAuthError('auth-error-login', 'El email no es válido.'); return; }
    if (!pass) { setAuthError('auth-error-login', 'Ingresá tu contraseña.'); return; }
    const btn = document.querySelector('#auth-panel-login .auth-submit-btn');
    btn.textContent = 'INGRESANDO...'; btn.disabled = true;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
    btn.textContent = 'INGRESAR'; btn.disabled = false;
    if (error) setAuthError('auth-error-login', translateAuthError(error));
};

window.doRegister = async () => {
    const nombre = document.getElementById('reg-nombre').value.trim();
    const whatsapp = document.getElementById('reg-whatsapp').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    setAuthError('auth-error-register', '');

    if (!nombre) { setAuthError('auth-error-register', 'Ingresá tu nombre.'); return; }
    if (!whatsapp) { setAuthError('auth-error-register', 'Ingresá tu WhatsApp.'); return; }
    if (!validatePhone(whatsapp)) { setAuthError('auth-error-register', 'El WhatsApp debe tener al menos 8 dígitos.'); return; }
    if (!email) { setAuthError('auth-error-register', 'Ingresá tu email.'); return; }
    if (!validateEmail(email)) { setAuthError('auth-error-register', 'El email no es válido.'); return; }
    if (!pass) { setAuthError('auth-error-register', 'Ingresá una contraseña.'); return; }
    if (pass.length < 6) { setAuthError('auth-error-register', 'La contraseña debe tener al menos 6 caracteres.'); return; }

    const btn = document.querySelector('#auth-panel-register .auth-submit-btn');
    btn.textContent = 'VERIFICANDO...'; btn.disabled = true;

    const { data: byPhone } = await supabaseClient.from('clientes').select('id').eq('whatsapp', whatsapp).maybeSingle();
    if (byPhone) {
        setAuthError('auth-error-register', 'Ese WhatsApp ya está registrado. Usá "Ingresar".');
        btn.textContent = 'CREAR CUENTA'; btn.disabled = false;
        return;
    }
    const { data: byEmail } = await supabaseClient.from('clientes').select('id').eq('email', email).maybeSingle();
    if (byEmail) {
        setAuthError('auth-error-register', 'Ese email ya está registrado. Usá "Ingresar".');
        btn.textContent = 'CREAR CUENTA'; btn.disabled = false;
        return;
    }

    btn.textContent = 'CREANDO CUENTA...';
    const { data, error } = await supabaseClient.auth.signUp({ email, password: pass, options: { data: { nombre } } });
    btn.textContent = 'CREAR CUENTA'; btn.disabled = false;

    if (error) { setAuthError('auth-error-register', translateAuthError(error)); return; }

    if (data.user) {
        const { data: existing } = await supabaseClient.from('clientes').select('id').eq('email', email).maybeSingle();
        if (existing) {
            await supabaseClient.from('clientes').update({ user_id: data.user.id, nombre, whatsapp }).eq('id', existing.id);
        } else {
            await supabaseClient.from('clientes').insert({ user_id: data.user.id, nombre, whatsapp, email, pedidos_count: 0, total_gastado: 0 });
        }
    }
};

window.doForgotPassword = async () => {
    const email = document.getElementById('login-email').value.trim();
    const errEl = document.getElementById('auth-error-login');
    if (!email) { setAuthError('auth-error-login', 'Ingresá tu email primero.'); return; }
    if (!validateEmail(email)) { setAuthError('auth-error-login', 'El email no es válido.'); return; }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    if (error) { setAuthError('auth-error-login', translateAuthError(error)); return; }
    setAuthError('auth-error-login', 'Te enviamos un email para restablecer tu contraseña.', true);
};

async function updateClienteStats(orderTotal) {
    if (!currentUser) return;
    const { data: cliente } = await supabaseClient.from('clientes').select('id, pedidos_count, total_gastado').eq('user_id', currentUser.id).maybeSingle();
    if (cliente) {
        await supabaseClient.from('clientes').update({
            pedidos_count: (cliente.pedidos_count || 0) + 1,
            total_gastado: (cliente.total_gastado || 0) + orderTotal,
            ultima_compra: new Date().toISOString()
        }).eq('id', cliente.id);
    }
}

function initScrollButtons() {
    const fab = document.getElementById('fab-menu');
    const scrollTop = document.getElementById('scroll-top-btn');
    const heroHeight = () => document.querySelector('.hero')?.offsetHeight || 400;

    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY > heroHeight();
        if (fab) fab.classList.toggle('fab-visible', scrolled && cart.length === 0);
        if (scrollTop) scrollTop.classList.toggle('fab-visible', window.scrollY > 600);
    }, { passive: true });
}

// 6. RENDER LOGIC
function renderMenu(items) {
    const grid = document.getElementById('menu-grid');
    const featuredSlot = document.getElementById('featured-burger');
    if (!grid) return;
    const status = getStoreStatus();

    const burgers = items.filter(p => p.category === 'burgers');
    const regular = burgers.filter(p => !p.title.toUpperCase().includes('MALBEC'));
    const featured = burgers.find(p => p.title.toUpperCase().includes('MALBEC'));

    const closedBtn = `style="background:#888; border-color:#888; cursor:not-allowed;"`;
    const openIcon = status.open ? 'plus' : 'clock';
    const btnLabel = status.open ? 'SUMAR AL CARRITO' : 'NEGOCIO CERRADO';

    grid.innerHTML = regular.map(item => `
        <div class="menu-item ${!status.open ? 'closed-item' : ''}" onclick="openProductModal('${item.id}')">
            ${item.destacado ? '<div class="badge-destacado">🔥 MÁS PEDIDO</div>' : ''}
            <div class="item-img">
                <img src="${item.img}" alt="${item.title}" loading="lazy">
                <span class="item-price-tag">$${item.simple.toLocaleString()}</span>
            </div>
            <div class="item-content">
                <h3>${item.title}</h3>
                <p class="item-desc">${item.desc}</p>
                <button class="add-btn" ${!status.open ? closedBtn : ''}>
                    <i data-lucide="${openIcon}"></i> ${btnLabel}
                </button>
            </div>
        </div>
    `).join('');

    if (featured && featuredSlot) {
        featuredSlot.innerHTML = `
            <div class="menu-item-featured ${!status.open ? 'closed-item' : ''}" onclick="openProductModal('${featured.id}')">
                <div class="featured-img">
                    <img src="${featured.img}" alt="${featured.title}" loading="lazy">
                </div>
                <div class="featured-content">
                    <span class="featured-label">EDICIÓN ESPECIAL</span>
                    <h3>${featured.title}</h3>
                    <p class="featured-desc">${featured.desc}</p>
                    <div class="featured-pricing">
                        <span>Simple $${featured.simple.toLocaleString()}</span>
                        <span>Doble $${featured.doble.toLocaleString()}</span>
                    </div>
                    <button class="add-btn-featured" ${!status.open ? closedBtn : ''}>
                        <i data-lucide="${openIcon}"></i> ${btnLabel}
                    </button>
                </div>
            </div>
        `;
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// 7. MODAL & CART LOGIC
window.openProductModal = function (id) {
    const status = getStoreStatus();
    if (!status.open) {
        showAlert("NEGOCIO CERRADO", `Podrás realizar tu pedido ${status.nextOpening}, ¡Te esperamos!`);
        return;
    }

    console.log("Opening modal for ID:", id);
    currentProduct = menuData.find(p => p.id === id);
    if (!currentProduct) {
        console.error("Product not found in menuData!");
        return;
    }

    currentQty = 1;
    currentType = "Simple";

    const modalImg = document.getElementById('modal-img');
    const modalTitle = document.getElementById('modal-title');
    const modalDesc = document.getElementById('modal-desc');
    const modalQty = document.getElementById('modal-qty');

    if (modalImg) modalImg.src = currentProduct.img;
    if (modalTitle) modalTitle.innerText = currentProduct.title;
    if (modalDesc) modalDesc.innerText = currentProduct.desc;
    if (modalQty) modalQty.innerText = currentQty;

    document.querySelectorAll('.modal-pill').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.type === "Simple") b.classList.add('active');
    });

    document.querySelectorAll('.extra-item input').forEach(i => i.checked = false);
    updateModalPrice();

    const modal = document.getElementById('product-modal');
    if (modal) modal.classList.add('active');
};

// Initialize listeners inside a function called from DOMContentLoaded
function initListeners() {
    const closeModalBtn = document.querySelector('#product-modal .close-modal');
    if (closeModalBtn) {
        closeModalBtn.onclick = () => document.getElementById('product-modal').classList.remove('active');
    }

    document.querySelectorAll('.modal-pill').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.modal-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentType = btn.dataset.type;
            updateModalPrice();
        };
    });

    document.querySelectorAll('.extra-item input').forEach(input => {
        input.onchange = () => updateModalPrice();
    });

    const addToCartBig = document.getElementById('add-to-cart-big');
    if (addToCartBig) {
        addToCartBig.onclick = () => {
            if (!currentProduct) return;
            console.log("Adding to cart:", currentProduct.title);

            let base = currentType === "Simple" ? currentProduct.simple : currentProduct.doble;
            let extras = [];
            let extrasTotal = 0;

            document.querySelectorAll('.extra-item input:checked').forEach(i => {
                extras.push(i.dataset.name);
                extrasTotal += parseInt(i.dataset.price) || 0;
            });

            cart.push({
                id: Date.now(),
                title: currentProduct.title,
                product_id: currentProduct.id,
                type: currentType,
                qty: currentQty,
                extras,
                pricePerUnit: base + extrasTotal,
                total: (base + extrasTotal) * currentQty
            });

            console.log("Cart updated:", cart);
            document.getElementById('product-modal').classList.remove('active');
            updateOrderBar();
            showUpsellModal();
        };
    }
}

function showUpsellModal() {
    const nuggets = menuData.filter(p => p.category === 'extras' && p.title.toUpperCase().includes('NUGGETS'));
    const grid = document.getElementById('upsell-nuggets-grid');
    if (!grid || !nuggets.length) { openCheckoutModal(); return; }

    grid.innerHTML = nuggets.map(p => `
        <div class="upsell-nugget-card">
            <div class="upsell-nugget-info">
                <h3>${p.title}</h3>
                <p class="upsell-nugget-price">$${p.simple.toLocaleString()}</p>
            </div>
            <button class="upsell-add-btn" id="upsell-btn-${p.id}" onclick="addNuggetFromUpsell('${p.id}')">
                + AGREGAR
            </button>
        </div>
    `).join('');

    const modal = document.getElementById('upsell-modal');
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.addNuggetFromUpsell = (productId) => {
    const product = menuData.find(p => p.id === productId);
    if (!product) return;
    const existing = cart.find(i => i.product_id === productId && i.type === '');
    if (existing) {
        existing.qty += 1;
        existing.total = existing.pricePerUnit * existing.qty;
    } else {
        cart.push({ id: Date.now(), title: product.title, product_id: product.id, type: '', qty: 1, extras: [], pricePerUnit: product.simple, total: product.simple });
    }
    updateOrderBar();
    const btn = document.getElementById(`upsell-btn-${productId}`);
    if (btn) { btn.textContent = '✓ AGREGADO'; btn.disabled = true; }
};

window.closeUpsellAndCheckout = () => {
    const modal = document.getElementById('upsell-modal');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 350);
    openCheckoutModal();
};

window.changeQty = (val) => {
    currentQty = Math.max(1, currentQty + val);
    const qtyEl = document.getElementById('modal-qty');
    if (qtyEl) qtyEl.innerText = currentQty;
    updateModalPrice();
};

function updateModalPrice() {
    if (!currentProduct) return;
    let base = currentType === "Simple" ? currentProduct.simple : currentProduct.doble;
    let extras = 0;
    document.querySelectorAll('.extra-item input:checked').forEach(i => {
        extras += parseInt(i.dataset.price) || 0;
    });
    const priceEl = document.getElementById('modal-total-price');
    if (priceEl) priceEl.innerText = `$${((base + extras) * currentQty).toLocaleString()}`;
}

function updateOrderBar() {
    let totalQty = cart.reduce((acc, i) => acc + i.qty, 0);
    let subtotal = cart.reduce((acc, i) => acc + i.total, 0);
    const headerQty = document.getElementById('cart-qty');
    if (headerQty) headerQty.innerText = totalQty;

    const badge = document.getElementById('cart-badge');
    if (badge) {
        if (totalQty > 0) { badge.textContent = totalQty; badge.style.display = 'flex'; }
        else badge.style.display = 'none';
    }

    const formatted = `$${subtotal.toLocaleString()}`;
    const modalPill = document.getElementById('modal-cart-pill');
    const modalTotal = document.getElementById('modal-cart-total');
    if (modalPill && modalTotal) {
        if (totalQty > 0) { modalPill.style.display = 'flex'; modalTotal.textContent = formatted; }
        else modalPill.style.display = 'none';
    }
    const upsellTotal = document.getElementById('upsell-cart-total');
    if (upsellTotal) upsellTotal.textContent = formatted;

    const bar = document.getElementById('order-bar');
    if (bar) {
        if (cart.length > 0) {
            bar.classList.add('active');
            document.getElementById('bar-items-count').innerText = `${totalQty} ITEM${totalQty > 1 ? 'S' : ''}`;
            document.getElementById('bar-total-price').innerText = `$${subtotal.toLocaleString()}`;
        } else bar.classList.remove('active');
    }

    const fab = document.getElementById('fab-menu');
    if (fab) fab.style.display = totalQty > 0 ? 'none' : '';
}

window.toggleCartModal = function () {
    const modal = document.getElementById('cart-modal');
    if (!modal) {
        console.error("Cart modal element not found!");
        return;
    }

    if (modal.classList.contains('active')) {
        modal.classList.remove('active');
        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                modal.style.display = 'none';
            }
        }, 400);
    } else {
        renderCartItems();
        modal.style.display = 'flex';
        // Force reflow
        modal.offsetHeight;
        modal.classList.add('active');
        console.log("Cart modal opened");
    }
};

function renderCartItems() {
    const list = document.getElementById('cart-items-list');
    const footer = document.querySelector('.cart-footer');
    if (!list) return;

    if (cart.length === 0) {
        list.innerHTML = `<div class="empty-cart-msg"><i data-lucide="shopping-bag"></i><p>TU CARRITO ESTÁ VACÍO</p></div>`;
        if (footer) footer.style.display = 'none';
    } else {
        if (footer) footer.style.display = 'block';
        list.innerHTML = cart.map((item, idx) => `
            <div class="cart-item">
                <div class="cart-item-info">
                    <h4>${item.title}</h4>
                    <span>${item.type}${item.extras.length ? ' + ' + item.extras.join(', ') : ''}</span>
                    <div class="cart-qty-controls">
                        <button onclick="updateCartQty(${idx}, -1)"><i data-lucide="minus"></i></button>
                        <span>${item.qty}</span>
                        <button onclick="updateCartQty(${idx}, 1)"><i data-lucide="plus"></i></button>
                    </div>
                </div>
                <div class="cart-item-actions">
                    <div class="cart-item-price">$${item.total.toLocaleString()}</div>
                    <button class="remove-item-btn" onclick="removeFromCart(${idx})"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        `).join('');

        document.getElementById('cart-final-total').innerText = `$${cart.reduce((a, i) => a + i.total, 0).toLocaleString()}`;
        renderUpsell();
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderUpsell() {
    const upsellGrid = document.getElementById('upsell-items');
    if (!upsellGrid || !menuData.length) return;

    // Filter out items already in cart to suggest other things
    const inCartIds = cart.map(i => i.product_id);
    const suggestions = menuData
        .filter(p => p.category === 'burgers' && !inCartIds.includes(p.id))
        .slice(0, 3);

    // If all burgers are in cart, just show 3 random ones
    const finalSug = suggestions.length > 0 ? suggestions : menuData.filter(p => p.category === 'burgers').slice(0, 3);

    upsellGrid.innerHTML = finalSug.map(p => `
        <div class="upsell-item" onclick="toggleCartModal(); openProductModal('${p.id}')">
            <img src="${p.img}" alt="${p.title}">
            <h5>${p.title}</h5>
            <p>$${p.simple.toLocaleString()}</p>
        </div>
    `).join('');
}

window.removeFromCart = (idx) => { cart.splice(idx, 1); renderCartItems(); updateOrderBar(); };
window.updateCartQty = (idx, chg) => {
    cart[idx].qty = Math.max(1, cart[idx].qty + chg);
    cart[idx].total = cart[idx].pricePerUnit * cart[idx].qty;
    renderCartItems(); updateOrderBar();
};

// 8. MARKETING & CHECKOUT ENGINE
window.applyCoupon = async function () {
    const code = document.getElementById('coupon-input').value.toUpperCase();
    const msg = document.getElementById('coupon-message');
    if (!code) return;

    try {
        const { data, error } = await supabaseClient.from('cupones').select('*').eq('codigo', code).eq('activo', true).single();
        if (error || !data) throw new Error("Cupón inválido");
        if (data.usos_actuales >= data.limite_usos) throw new Error("Cupón agotado");

        appliedCoupon = data;
        msg.innerText = "¡Cupón aplicado!";
        msg.className = "coupon-msg success";
        document.getElementById('apply-coupon-btn').innerText = "QUITAR";
        document.getElementById('apply-coupon-btn').onclick = removeCoupon;
        openCheckoutModal(); // Refresh prices
    } catch (e) {
        msg.innerText = e.message;
        msg.className = "coupon-msg error";
        appliedCoupon = null;
        openCheckoutModal();
    }
};

window.removeCoupon = function () {
    appliedCoupon = null;
    document.getElementById('coupon-input').value = "";
    document.getElementById('coupon-message').innerText = "";
    document.getElementById('apply-coupon-btn').innerText = "APLICAR";
    document.getElementById('apply-coupon-btn').onclick = applyCoupon;
    openCheckoutModal();
};

function calculateCartMarketing() {
    let subtotal = cart.reduce((acc, i) => acc + i.total, 0);
    let discount = 0;
    let appliedPromoId = null;

    // A. Automatic Promos (Only one for simplicity, or cumulative)
    activePromos.forEach(p => {
        if (p.tipo === 'percent') discount += subtotal * (p.valor / 100);
        if (p.tipo === 'fixed') discount += p.valor;
        if (p.tipo === 'multi_buy') {
            cart.forEach(item => {
                if (item.qty >= p.buy_qty) {
                    let sets = Math.floor(item.qty / p.buy_qty);
                    discount += (p.buy_qty - p.get_qty) * item.pricePerUnit * sets;
                }
            });
        }
        if (p.tipo === 'second_unit') {
            cart.forEach(item => {
                if (item.qty >= 2) {
                    let pairs = Math.floor(item.qty / 2);
                    discount += (item.pricePerUnit * (p.second_unit_percent / 100)) * pairs;
                }
            });
        }
        if (discount > 0) appliedPromoId = p.id;
    });

    // B. Applied Coupon
    if (appliedCoupon) {
        let c = appliedCoupon;
        if (c.tipo === 'percent') discount += subtotal * (c.valor / 100);
        if (c.tipo === 'fixed') discount += c.valor;
        if (c.tipo === 'multi_buy') {
            cart.forEach(item => {
                if (item.qty >= c.buy_qty) {
                    let sets = Math.floor(item.qty / c.buy_qty);
                    discount += (c.buy_qty - c.get_qty) * item.pricePerUnit * sets;
                }
            });
        }
        if (c.tipo === 'second_unit') {
            cart.forEach(item => {
                if (item.qty >= 2) {
                    let pairs = Math.floor(item.qty / 2);
                    discount += (item.pricePerUnit * (c.second_unit_percent / 100)) * pairs;
                }
            });
        }
    }

    return { discount: Math.min(discount, subtotal), promoId: appliedPromoId };
}

window.openCheckoutModal = function () {
    if (cart.length === 0) return;
    if (!currentUser) { openAuthModal(true); return; }
    updateCheckoutPrices();
    const modal = document.getElementById('checkout-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
};

window.updateCheckoutPrices = function () {
    let subtotal = cart.reduce((acc, i) => acc + i.total, 0);
    let { discount, promoId } = calculateCartMarketing();

    // Shipping Calculation
    let shipping = 0;
    if (currentDeliveryMethod === 'delivery') {
        const zoneSelect = document.getElementById('shipping-zone');
        shipping = zoneSelect ? parseInt(zoneSelect.value) : 0;
    }

    let total = subtotal - discount + shipping;

    document.getElementById('summary-subtotal').innerText = `$${subtotal.toLocaleString()}`;
    const discRow = document.getElementById('discount-row');
    if (discount > 0) {
        discRow.style.display = 'flex';
        document.getElementById('summary-discount').innerText = `-$${discount.toLocaleString()}`;
    } else discRow.style.display = 'none';

    const shipEl = document.getElementById('summary-shipping');
    if (shipEl) {
        shipEl.innerText = shipping === 0 ? "GRATIS" : `$${shipping.toLocaleString()}`;
        shipEl.className = shipping === 0 ? "free" : "";
    }

    document.getElementById('summary-total').innerText = `$${total.toLocaleString()}`;
};

window.openCoverageModal = () => {
    const modal = document.getElementById('coverage-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
};

window.closeCoverageModal = () => {
    const modal = document.getElementById('coverage-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 400);
};

window.closeCheckoutModal = () => {
    const modal = document.getElementById('checkout-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 400);
};

// Auto-fill customer data by phone
document.addEventListener('DOMContentLoaded', () => {
    const phoneInput = document.getElementById('cust-phone');
    if (phoneInput) {
        phoneInput.addEventListener('blur', async () => {
            const phone = phoneInput.value.trim();
            if (phone.length < 8) return;

            console.log("Checking customer for phone:", phone);
            try {
                const { data, error } = await supabaseClient
                    .from('clientes')
                    .select('nombre, email')
                    .eq('whatsapp', phone)
                    .single();

                if (data) {
                    console.log("Customer found! Auto-filling data...");
                    const nameInput = document.getElementById('cust-name');
                    const emailInput = document.getElementById('cust-email');

                    if (nameInput) nameInput.value = data.nombre;
                    if (emailInput) emailInput.value = data.email;

                    // Visual feedback
                    phoneInput.style.borderColor = "#2E7D32";
                    setTimeout(() => phoneInput.style.borderColor = "", 2000);
                }
            } catch (e) {
                // Not found or error, ignore
            }
        });
    }
});

// Toggle delivery
document.querySelectorAll('.method-pill').forEach(pill => {
    pill.onclick = () => {
        document.querySelectorAll('.method-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentDeliveryMethod = pill.dataset.method;
        document.getElementById('address-section').style.display = (currentDeliveryMethod === 'pickup') ? 'none' : 'block';
        updateCheckoutPrices();
    };
});

// Final Checkout
const checkoutForm = document.getElementById('checkout-form');
if (checkoutForm) {
    checkoutForm.onsubmit = async (e) => {
        e.preventDefault();
        const payBtn = document.getElementById('pay-button');
        payBtn.disabled = true;
        payBtn.innerHTML = '<span class="loading-spinner"></span> PROCESANDO...';

        try {
            let subtotal = cart.reduce((acc, i) => acc + i.total, 0);
            let { discount, promoId } = calculateCartMarketing();

            let shipping = 0;
            if (currentDeliveryMethod === 'delivery') {
                const zoneSelect = document.getElementById('shipping-zone');
                shipping = zoneSelect ? parseInt(zoneSelect.value) : 0;
            }

            let total = subtotal - discount + shipping;

            // 1. Client Handling (Check if exists first)
            const phone = document.getElementById('cust-phone').value;
            let clientId = null;

            const { data: existingClient } = await supabaseClient
                .from('clientes')
                .select('id')
                .eq('whatsapp', phone)
                .maybeSingle();

            if (existingClient) {
                console.log("Existing client found, using ID:", existingClient.id);
                clientId = existingClient.id;
            } else {
                console.log("New client, capturing data...");
                const { data: newClient, error: cErr } = await supabaseClient.from('clientes').insert({
                    nombre: document.getElementById('cust-name').value,
                    whatsapp: phone,
                    email: document.getElementById('cust-email').value,
                    direccion: document.getElementById('cust-address').value,
                    zona: currentDeliveryMethod === 'delivery' ? document.getElementById('shipping-zone').options[document.getElementById('shipping-zone').selectedIndex].text : null
                }).select();
                if (cErr) throw cErr;
                clientId = newClient[0].id;
            }

            // 2. Insert Order
            const { data: oData, error: oErr } = await supabaseClient.from('pedidos').insert({
                cliente_id: clientId,
                user_id: currentUser ? currentUser.id : null,
                items: cart,
                metodo_entrega: currentDeliveryMethod,
                direccion_entrega: currentDeliveryMethod === 'delivery' ? document.getElementById('cust-address').value : 'Retiro en Local',
                zona: currentDeliveryMethod === 'delivery' ? document.getElementById('shipping-zone').options[document.getElementById('shipping-zone').selectedIndex].text : null,
                subtotal,
                monto_descuento: discount,
                costo_envio: shipping,
                total,
                promo_id: promoId,
                cupon_id: appliedCoupon ? appliedCoupon.id : null,
                estado_pago: 'pendiente'
            }).select();
            if (oErr) throw oErr;

            // 3. Discount stock & usage
            if (appliedCoupon) {
                await supabaseClient.from('cupones').update({ usos_actuales: appliedCoupon.usos_actuales + 1 }).eq('id', appliedCoupon.id);
            }
            await supabaseClient.rpc('descontar_stock_pedido', { p_pedido_id: oData[0].id });

            await updateClienteStats(total);
            showAlert("PEDIDO RECIBIDO", `¡Pedido #${oData[0].numero_pedido} recibido! ¡Muchas gracias por elegirnos!`);
            cart = []; appliedCoupon = null;
            updateOrderBar(); closeCheckoutModal();
        } catch (err) {
            console.error(err);
            showAlert("ERROR", "Hubo un problema al procesar tu pedido. Por favor, revisá los datos e intentá de nuevo.");
        } finally {
            payBtn.disabled = false;
            payBtn.innerHTML = 'MERCADO PAGO <img src="mp.png" alt="MP" class="mp-btn-logo">';
        }
    };
}
