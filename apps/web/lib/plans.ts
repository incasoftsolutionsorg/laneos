// Plans offered at sign-up (Figma 1-90). Same ids, prices and limits as public.plans
// (migration 20261023090600); the sign-up page is public and cannot read that table.
export const SIGNUP_PLANS = [
  { id: 'lite', name: 'Kade Lite', price: 'Rs 2,900 / mo', text: '1 shop · 1 lane' },
  { id: 'single', name: 'Store Pro', price: 'Rs 5,400 / mo', text: '1 shop · up to 4 lanes · promotions' },
  { id: 'growth', name: 'Multi-store', price: 'Rs 4,900 / shop', text: 'Up to 5 shops · transfers' },
  { id: 'chain', name: 'Chain', price: 'Custom', text: 'Head office, API, custom domain', contact: true },
] as const;

export const CITIES = [
  'Colombo', 'Dehiwala-Mount Lavinia', 'Moratuwa', 'Negombo', 'Kandy', 'Galle', 'Matara', 'Kurunegala', 'Jaffna', 'Batticaloa',
  'Trincomalee', 'Anuradhapura', 'Polonnaruwa', 'Ratnapura', 'Badulla', 'Nuwara Eliya', 'Kalutara', 'Gampaha', 'Kegalle',
  'Hambantota', 'Vavuniya', 'Puttalam', 'Chilaw', 'Ampara', 'Monaragala', 'Matale', 'Kilinochchi', 'Mannar', 'Mullaitivu', 'Other',
] as const;
