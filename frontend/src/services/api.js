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
export const matchPayment  = (id, tenantId) => API.post(`/payments/${id}/match`, { tenantId });

// Maintenance
export const getMaintenance = ()     => API.get('/maintenance');
export const addMaintenance = (data) => API.post('/maintenance', data);