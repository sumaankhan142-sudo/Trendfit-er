const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const dropsConfigPath = path.resolve(__dirname, 'drops.config.js');
const drops = require('./drops.config');
const app = express();
const PORT = 3000;
function refreshDropNumbers() {
    drops.forEach((drop, index) => {
        const number = index + 1;
        const padded = String(number).padStart(2, '0');
        drop.dropNumber = number;

        // ── FIX: always ensure ID is a string ──────────────
        if (!drop.id) {
            drop.id = String(number);
        } else {
            drop.id = String(drop.id); // convert number IDs to string
        }

        if (!drop.theme) drop.theme = '';

        // Only auto-assign label/navLabel/badge if they're blank
        // DO NOT overwrite custom values the user typed
        if (!drop.label) {
            drop.label = `DROP #${padded}`;
        }
        if (!drop.navLabel) {
            drop.navLabel = `Drop #${padded}`;
        }
        if (!drop.badge) {
            const themeTag = drop.theme ? ` // ${drop.theme.toUpperCase()}` : ' // LIMITED EDITION';
            drop.badge = `DROP ${padded}${themeTag}`;
        }
    });
}


function saveDropsConfig() {
    drops.forEach(drop => {
        drop.id = String(drop.id || Date.now());
    });

    const fileContent = `// ============================================================
//  TRENDFIT'ER — DROP CONTROL CENTER
//  This file is auto-updated by the admin panel.
// ============================================================
const drops = ${JSON.stringify(drops, null, 2)};

module.exports = drops;
`;

    try {
        fs.writeFileSync(dropsConfigPath, fileContent, 'utf8');
        console.log('[DROPS] Config saved successfully.');
    } catch (err) {
        console.error('[DROPS] Failed to save config:', err.message);
    }
}
let products = [];
let cart = [];
let orders = [];
let wishlistItems = [];
let waitlist = [];
let checkoutItems = [];
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
    if (req.path.startsWith('/admin')) {
        console.log(`[ADMIN ROUTE] ${req.method} ${req.path}`);
    }
    next();
});

app.get('/', (req, res) => {
  const activeDrop = drops.find(d => d.active) || drops[drops.length - 1];
  const pastDrops  = drops.filter(d => !d.active && d.soldOut);
  res.render('index', { products, activeDrop, pastDrops, drops });
});

app.get('/admin', (req, res) => {
    res.render('admin', { products, drops });
});

app.get('/admin/drop/add', (req, res) => {
    return res.redirect('/admin');
});

app.post('/admin/drop/add', (req, res) => {
    console.log('POST /admin/drop/add', req.method, req.path, Object.keys(req.body || {}).length, req.body);
    const { label, navLabel, badge, title, subtitle, totalUnits, endDate, theme } = req.body;
    const active = !drops.some(d => d.active);
    const newDrop = {
        id: Date.now().toString(),
        theme: theme || '',
        label: label || `DROP #${String(drops.length + 1).padStart(2, '0')}`,
        navLabel: navLabel || `Drop #${String(drops.length + 1).padStart(2, '0')}`,
        badge: badge || `DROP ${String(drops.length + 1).padStart(2, '0')} // ${theme ? theme.toUpperCase() : 'LIMITED EDITION'}`,
        title: title || 'New Drop Title',
        subtitle: subtitle || 'New drop subtitle.',
        active,
        soldOut: false,
        totalUnits: parseInt(totalUnits) || 0,
        unitsSold: 0,
        endDate: endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)
    };
    drops.push(newDrop);
    saveDropsConfig();
    res.redirect('/admin');
});

app.post('/admin/drop/update/:id', (req, res) => {
    const drop = drops.find(d => d.id === req.params.id);
    if (!drop) return res.redirect('/admin');

    const { label, navLabel, badge, title, subtitle, totalUnits, unitsSold, endDate, active, soldOut, theme } = req.body;
    drop.theme = theme || drop.theme || '';
    drop.label = label || drop.label;
    drop.navLabel = navLabel || drop.navLabel;
    drop.badge = badge || drop.badge;
    drop.title = title || drop.title;
    drop.subtitle = subtitle || drop.subtitle;
    drop.totalUnits = parseInt(totalUnits) || 0;
    drop.unitsSold = parseInt(unitsSold) || 0;
    drop.endDate = endDate || drop.endDate;
    drop.soldOut = soldOut === 'true' || drop.unitsSold >= drop.totalUnits;

    if (active === 'true') {
        drops.forEach(d => d.active = false);
        drop.active = true;
    }

    saveDropsConfig();
    res.redirect('/admin');
});

app.post('/admin/drop/delete/:id', (req, res) => {
    const index = drops.findIndex(d => d.id === req.params.id);
    if (index > -1) {
        drops.splice(index, 1);
        saveDropsConfig();
    }
    res.redirect('/admin');
});

app.post('/admin/drop/reset', (req, res) => {
    refreshDropNumbers();
    const target = drops.find(d => d.dropNumber === 1) || drops[0];
    if (target) {
        drops.forEach(d => d.active = false);
        target.active = true;
        target.soldOut = target.unitsSold >= target.totalUnits;
        saveDropsConfig();
    }
    res.redirect('/admin');
});

app.get('/product/:id', (req, res) => {
    const product = products.find(p => p.id == req.params.id);
    if (product) {
        res.render('product-detail', { product });
    } else {
        res.status(404).send('<h1>Product Not Found</h1><a href="/">Back to Shop</a>');
    }
});

app.post('/admin/add-product', upload.array('images', 10), async (req, res) => {
    try {
        const { name, description, stock } = req.body;
        const price = parseFloat(req.body.price); // ← force number

        if (!req.files || req.files.length === 0) {
            return res.status(400).send('No files were uploaded.');
        }

        const imageUrls = req.files.map(file => `/uploads/${file.filename}`);

        const newProduct = {
            id: Date.now().toString(),
            name,
            description,
            price,      // ← stored as number
            stock,
            imageUrls,
            imageUrl: imageUrls[0]
        };

        products.push(newProduct);
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/admin/delete/:id', (req, res) => {
    products = products.filter(p => p.id !== req.params.id);
    res.redirect('/admin');
});

// Single /cart/add route — checks for existing item
app.post('/cart/add/:id', (req, res) => {
    const productId = req.params.id;
    const product = products.find(p => p.id == productId);

    if (product) {
        const existingItem = cart.find(item => item.id == productId);
        if (existingItem) {
            existingItem.quantity = (existingItem.quantity || 1) + 1;
        } else {
            cart.push({ ...product, price: parseFloat(product.price), quantity: 1 });
        }
    }

    res.json({
        success: true,
        message: 'Item added to cart',
        cartCount: cart.reduce((acc, item) => acc + (item.quantity || 1), 0)
    });
});

app.post('/cart/update/:id', (req, res) => {
    const productId = req.params.id;
    const action = req.query.action;
    const item = cart.find(item => item.id == productId);

    if (item) {
        if (action === 'increase') {
            item.quantity = (item.quantity || 1) + 1;
        } else if (action === 'decrease') {
            item.quantity = (item.quantity || 1) - 1;
            if (item.quantity <= 0) {
                cart = cart.filter(i => i.id != productId);
            }
        }
    }
    res.redirect('/cart');
});

app.get('/cart', (req, res) => {
    // Use the shared in-memory cart array in this simple app
    res.render('cart', {
        cartItems: cart,
    });
});

app.get('/checkout', (req, res) => {
    if (cart.length === 0) return res.redirect('/cart');
    checkoutItems = [...cart];  // store cart snapshot for order/complete
    res.render('checkout-cart', { cartItems: checkoutItems });
});

app.get('/buy/:id', (req, res) => {
    const product = products.find(p => p.id == req.params.id);
    if (product) {
        const item = { ...product, price: parseFloat(product.price), quantity: 1 };
        checkoutItems = [item];  // store for order/complete
        res.render('checkout-cart', { cartItems: checkoutItems });
    } else {
        res.redirect('/');
    }
});


// ── REPLACE your app.post('/buy/:id') ────────────────────────
app.post('/buy/:id', (req, res) => {
    const product = products.find(p => p.id == req.params.id);
    if (product) {
        const item = { ...product, price: parseFloat(product.price), quantity: 1 };
        checkoutItems = [item];  // store for order/complete
        res.render('checkout-cart', { cartItems: checkoutItems });
    } else {
        res.redirect('/');
    }
});
app.post('/order/complete', (req, res) => {

    // Use checkoutItems (set by /buy or /checkout), fallback to cart
    const itemsInOrder = checkoutItems.length > 0 ? [...checkoutItems] : [...cart];

    const codFee = parseInt(req.body.codFee) || 0;

    // Calculate subtotal from actual items
    const subtotal = itemsInOrder.reduce((sum, item) => {
        return sum + (parseFloat(item.price) * (parseInt(item.quantity) || 1));
    }, 0);

    const total = subtotal + codFee;

    const rawTxn = Array.isArray(req.body.transactionId)
        ? req.body.transactionId.find(t => t && t.trim() !== '')
        : req.body.transactionId;

    const newOrder = {
        id: Date.now().toString(),
        customerName: req.body.name,
        address: req.body.address,
        phone: req.body.phone,
        city: req.body.cityName || 'N/A',
        paymentMethod: req.body.paymentMethod || 'cod',
        transactionId: (rawTxn && rawTxn.trim() !== '') ? rawTxn.trim() : 'N/A',
        codFee,
        subtotal,
        total,
        items: itemsInOrder,
        date: new Date().toLocaleString()
    };

    orders.push(newOrder);

    // ── UPDATE UNITS SOLD IN ACTIVE DROP ──────────────────
    const activeDrop = drops.find(d => d.active);
    if (activeDrop) {
        // Count total units sold in this order
        const unitsSoldInOrder = itemsInOrder.reduce((sum, item) => {
            return sum + (parseInt(item.quantity) || 1);
        }, 0);
        
        // Increment unitsSold
        activeDrop.unitsSold += unitsSoldInOrder;
        
        // Mark as sold out if we've reached the limit
        if (activeDrop.unitsSold >= activeDrop.totalUnits) {
            activeDrop.soldOut = true;
            activeDrop.unitsSold = activeDrop.totalUnits;
        }
    }

    // Clear cart only if order came from cart (not direct buy)
    if (checkoutItems.length > 0 && cart.length > 0) {
        cart = [];
    } else if (checkoutItems === cart || JSON.stringify(checkoutItems) === JSON.stringify(cart)) {
        cart = [];
    }

    // Reset checkoutItems
    checkoutItems = [];

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Trendfit'er // Order Confirmed</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Unbounded:wght@500;800&display=swap');

                * { box-sizing: border-box; margin: 0; padding: 0; }

                body {
                    background-color: #060606;
                    color: #fff;
                    font-family: 'Space Grotesk', sans-serif;
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 40px 20px;
                }

                .check-icon {
                    width: 64px;
                    height: 64px;
                    border-radius: 18px;
                    background: rgba(0, 255, 135, 0.1);
                    border: 1px solid rgba(0, 255, 135, 0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 28px;
                    margin-bottom: 20px;
                }

                h1 {
                    font-family: 'Unbounded', sans-serif;
                    font-size: 20px;
                    font-weight: 800;
                    letter-spacing: -1px;
                    text-transform: uppercase;
                    margin-bottom: 28px;
                    color: #fff;
                }

                .summary-box {
                    width: 100%;
                    max-width: 420px;
                    background: #0f0f0f;
                    border: 1px solid #1a1a1a;
                    border-radius: 20px;
                    padding: 24px 28px;
                    margin-bottom: 24px;
                }

                .section-label {
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 2px;
                    color: #333;
                    text-transform: uppercase;
                    margin-bottom: 14px;
                }

                .row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 13px;
                    padding: 10px 0;
                    border-bottom: 1px solid #111;
                    gap: 24px;
                }

                .row:last-child { border-bottom: none; }
                .row .label { color: #555; white-space: nowrap; }
                .row .value { color: #fff; font-weight: 700; text-align: right; }

                .row.total-row {
                    margin-top: 4px;
                    padding-top: 16px;
                    border-top: 1px solid #1a1a1a;
                    border-bottom: none;
                }

                .row.total-row .label {
                    font-family: 'Unbounded', sans-serif;
                    font-size: 10px;
                    font-weight: 800;
                    color: #555;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }

                .row.total-row .value {
                    font-family: 'Unbounded', sans-serif;
                    font-size: 22px;
                    font-weight: 800;
                    color: #00FF87;
                    letter-spacing: -1px;
                }

                .items-box {
                    width: 100%;
                    max-width: 420px;
                    background: #080808;
                    border: 1px solid #111;
                    border-radius: 16px;
                    padding: 16px 20px;
                    margin-bottom: 24px;
                }

                .item-row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 12px;
                    padding: 8px 0;
                    border-bottom: 1px solid #111;
                    color: #555;
                }

                .item-row:last-child { border-bottom: none; }
                .item-row .item-name { color: #888; font-weight: 700; text-transform: uppercase; font-size: 11px; }
                .item-row .item-price { color: #00FF87; font-weight: 700; }

                .back-btn {
                    display: inline-block;
                    background: #00FF87;
                    color: #000;
                    text-decoration: none;
                    font-family: 'Unbounded', sans-serif;
                    font-size: 10px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    padding: 16px 32px;
                    border-radius: 12px;
                    transition: all 0.2s ease;
                }

                .back-btn:hover {
                    background: #fff;
                    box-shadow: 0 0 20px rgba(0,255,135,0.2);
                }
            </style>
        </head>
        <body>
            <div class="check-icon">✓</div>
            <h1>Order Confirmed</h1>

            <!-- Items ordered -->
            <div class="items-box">
                <div class="section-label">Items Ordered</div>
                ${itemsInOrder.map(item => `
                    <div class="item-row">
                        <span class="item-name">${item.name} × ${item.quantity || 1}</span>
                        <span class="item-price">PKR ${(parseFloat(item.price) * (parseInt(item.quantity) || 1)).toFixed(0)}</span>
                    </div>
                `).join('')}
            </div>

            <!-- Payment summary -->
            <div class="summary-box">
                <div class="section-label">Payment Summary</div>
                <div class="row">
                    <span class="label">Method</span>
                    <span class="value">${newOrder.paymentMethod.toUpperCase()}</span>
                </div>
                ${newOrder.paymentMethod !== 'cod'
                    ? `<div class="row"><span class="label">Transaction ID</span><span class="value">${newOrder.transactionId}</span></div>`
                    : ''
                }
                <div class="row">
                    <span class="label">Subtotal</span>
                    <span class="value">PKR ${newOrder.subtotal.toFixed(0)}</span>
                </div>
                ${newOrder.codFee > 0 ? `
                <div class="row">
                    <span class="label">Delivery (${newOrder.city})</span>
                    <span class="value">PKR ${newOrder.codFee}</span>
                </div>` : ''}
                <div class="row total-row">
                    <span class="label">Total Paid</span>
                    <span class="value">PKR ${newOrder.total.toFixed(0)}</span>
                </div>
            </div>

            <a href="/" class="back-btn">Continue Shopping</a>
        </body>
        </html>
    `);
});
app.get('/admin/orders', (req, res) => {
    res.render('admin-orders', { orders });
});

app.post('/cart/wishlist/:id', (req, res) => {
    const itemId = req.params.id;
    const itemIndex = cart.findIndex(item => item.id === itemId);
    if (itemIndex > -1) {
        const [movedItem] = cart.splice(itemIndex, 1);
        wishlistItems.push(movedItem);
        return res.json({ success: true, cartCount: cart.length });
    }
    res.status(404).json({ success: false, message: 'Item not found in cart' });
});

app.post('/cart/remove/:id', (req, res) => {
    const itemId = req.params.id;
    const itemIndex = cart.findIndex(item => item.id === itemId);
    if (itemIndex > -1) {
        cart.splice(itemIndex, 1);
        return res.json({ success: true, cartCount: cart.length });
    }
    res.status(404).json({ success: false, message: 'Item not found' });
});

app.get('/wishlist', (req, res) => {
    res.render('wishlist', { wishlistItems });
});
app.post('/waitlist', (req, res) => {
  const { email, phone, dropLabel } = req.body;
  if (!email || !email.includes('@')) return res.json({ success: false, message: 'Invalid email.' });
  if (waitlist.find(w => w.email === email)) return res.json({ success: false, message: 'Already on the list!' });
  waitlist.push({ email, phone: phone || '', dropLabel, joinedAt: new Date().toISOString() });
  res.json({ success: true });
});
app.get('/admin/waitlist', (req, res) => res.render('admin', { products, drops, waitlist }));
app.post('/wishlist/move-to-cart/:id', (req, res) => {
    const itemId = req.params.id;
    const itemIndex = wishlistItems.findIndex(item => item.id === itemId);
    if (itemIndex > -1) {
        const [item] = wishlistItems.splice(itemIndex, 1);
        const existingInCart = cart.find(c => c.id === itemId);
        if (existingInCart) {
            existingInCart.quantity = (existingInCart.quantity || 1) + 1;
        } else {
            cart.push({ ...item, quantity: 1 });
        }
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

app.post('/wishlist/remove/:id', (req, res) => {
    const itemId = req.params.id;
    wishlistItems = wishlistItems.filter(item => item.id !== itemId);
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Trendfit'er is running on http://localhost:${PORT}`);
});