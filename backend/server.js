const express = require('express');
const cors    = require('cors');
require('dotenv').config();

// TEMPORARY DIAGNOSTIC — remove once the AT_USERNAME "username is required"
// issue is confirmed fixed. Prints the raw env values at boot, with
// JSON.stringify so hidden leading/trailing spaces or stray quote
// characters show up as visible characters instead of being invisible.
console.log('[DIAG] AT_USERNAME:', JSON.stringify(process.env.AT_USERNAME), 'length:', process.env.AT_USERNAME?.length);
console.log('[DIAG] AT_API_KEY set:', !!process.env.AT_API_KEY, 'length:', process.env.AT_API_KEY?.length);
console.log('[DIAG] AT_SENDER_ID:', JSON.stringify(process.env.AT_SENDER_ID));

const app = express();

// Middleware — process incoming requests
app.use(cors({
  origin: (origin, callback) => callback(null, true), // Allow all origins (local network)
  credentials: true,
}));
app.use(express.json());                 // Parse JSON request bodies
app.use('/uploads', express.static('uploads')); // Serve uploaded files

// Import route files (we'll create these next)
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/plots',       require('./routes/plots'));
app.use('/api/houses',      require('./routes/houses'));
app.use('/api/tenants',     require('./routes/tenants'));
app.use('/api/payments',    require('./routes/payments'));
app.use('/api/expenses',    require('./routes/expenses'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/mpesa',       require('./routes/mpesa'));
app.use('/api/sms',         require('./routes/sms').router);
app.use('/api/listings',    require('./routes/listings')); // public portal
app.use('/api/tenant-portal', require('./routes/tenantportal'));
app.use('/api/notices', require('./routes/notices'));
app.use('/api/deposits', require('./routes/deposits'));
app.use('/api/audit-log', require('./routes/auditlog'));
app.use('/api/statements', require('./routes/statements'));

// Health check — visit http://localhost:5000/api/health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'RentFlow API running!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));

require('./jobs/balanceUpdater');
