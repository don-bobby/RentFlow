import axios from 'axios';

// Base URL of your backend server
const API = axios.create({ baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api' });

// Auto-attach the login token to every request
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default API;

// Auth
export const login    = (data) => API.post('/auth/login', data);
export const register = (data) => API.post('/auth/register', data);
export const getMe    = ()     => API.get('/auth/me');

// Users / roles (Phase 3 backend)
export const createUser              = (data)          => API.post('/auth/users', data);
export const getUsers                = ()               => API.get('/auth/users');
export const getPendingLandlordsCount = ()              => API.get('/auth/users/pending-landlords-count');
export const approveUser             = (id, agentId)    => API.patch(`/auth/users/${id}/approve`, { agent_id: agentId || null });
export const rejectUser              = (id)              => API.patch(`/auth/users/${id}/reject`);
export const setLandlordAgent        = (id, agentId)    => API.patch(`/auth/users/${id}/agent`, { agent_id: agentId || null });

// Roles & Permissions matrix
export const getRolePermissions    = ()                             => API.get('/auth/role-permissions');
export const setRolePermission     = (profile, permission, allowed) => API.patch('/auth/role-permissions', { profile, permission, allowed });

// Properties
export const getPlots = ()     => API.get('/plots');
export const addPlot  = (data) => API.post('/plots', data);
export const getHouses = (plotId) => API.get(`/houses?plot=${plotId}`);

// Tenants
export const getTenants   = ()     => API.get('/tenants');
export const getTenant    = (id)   => API.get(`/tenants/${id}`);
export const addTenant    = (data) => API.post('/tenants', data);
export const updateTenant = (id, data) => API.put(`/tenants/${id}`, data);

// Payments
export const getPayments   = () => API.get('/payments');
export const deletePayment = (id) => API.delete(`/payments/${id}`);

// M-Pesa reconciliation (backend/routes/mpesa.js)
// NOTE: matchPayment used to POST to /payments/:id/match with { tenantId } —
// that route never existed. The real endpoint is PATCH /mpesa/:id/match,
// which needs both tenant_id AND house_id.
export const getUnmatchedPayments = ()                        => API.get('/mpesa/unmatched');
export const matchPayment         = (id, tenantId, houseId)   => API.patch(`/mpesa/${id}/match`, { tenant_id: tenantId, house_id: houseId });

// Maintenance
export const getMaintenance = ()     => API.get('/maintenance');
export const addMaintenance = (data) => API.post('/maintenance', data);