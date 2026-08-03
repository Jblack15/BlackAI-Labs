-- Demo user: demo@collisionai.com / password123
-- Password hash generated with Bun.password.hash('password123')
INSERT INTO users (email, password_hash, name, shop_name) VALUES
  ('demo@collisionai.com', '$2b$10$placeholder_will_be_replaced', 'Joe Smith', 'Smith Auto Body')
ON CONFLICT (email) DO NOTHING;

-- Sample waitlist entries
INSERT INTO waitlist (email, subscribed_at) VALUES
  ('mike@quickfixgarage.com', NOW() - INTERVAL '5 days'),
  ('sarah@premiumautorepair.com', NOW() - INTERVAL '3 days'),
  ('carlos@downtowncollision.com', NOW() - INTERVAL '1 day')
ON CONFLICT (email) DO NOTHING;

-- Sample estimate for demo user
INSERT INTO estimates (user_id, original_text, explanation, created_at)
SELECT id,
  'Replace front bumper assembly - $850.00
Paint front bumper - $450.00
Replace right headlight assembly - $620.00
Align front end - $180.00
Labor (4.5 hrs @ $120/hr) - $540.00
Shop supplies - $45.00
Tax - $189.75
Total: $2,874.75',
  'Here''s a plain-English breakdown of your estimate:
1. Your front bumper needs to be replaced due to collision damage ($850)
2. The new bumper will be painted to match your car''s color ($450)
3. The right headlight was damaged and needs a full replacement ($620)
4. The front end alignment ensures your car drives straight ($180)
5. Labor is 4.5 hours of skilled technician work at $120/hour ($540)
6. Shop supplies cover materials like sandpaper, cleaners, etc. ($45)
Tax is calculated at your local rate.',
  NOW() - INTERVAL '2 days'
FROM users WHERE email = 'demo@collisionai.com';

-- Sample conversation for demo user
INSERT INTO conversations (user_id, customer_name, customer_vehicle, status, created_at)
SELECT id, 'Alice Johnson', '2022 Honda Accord', 'active', NOW() - INTERVAL '4 days'
FROM users WHERE email = 'demo@collisionai.com';

-- Sample messages for the conversation
INSERT INTO messages (conversation_id, role, content, created_at)
SELECT c.id, 'customer', 'Hi, I was wondering when my Accord will be ready for pickup?', NOW() - INTERVAL '4 days'
FROM conversations c JOIN users u ON c.user_id = u.id WHERE u.email = 'demo@collisionai.com';

INSERT INTO messages (conversation_id, role, content, created_at)
SELECT c.id, 'ai', 'Hi Alice! Your Honda Accord is currently in the painting stage. We expect it to be ready by Thursday afternoon. I''ll send you a notification as soon as it''s done!', NOW() - INTERVAL '4 days' + INTERVAL '2 minutes'
FROM conversations c JOIN users u ON c.user_id = u.id WHERE u.email = 'demo@collisionai.com';

INSERT INTO messages (conversation_id, role, content, created_at)
SELECT c.id, 'customer', 'Great, thank you! Can you also let me know the final total?', NOW() - INTERVAL '4 days' + INTERVAL '5 minutes'
FROM conversations c JOIN users u ON c.user_id = u.id WHERE u.email = 'demo@collisionai.com';

INSERT INTO messages (conversation_id, role, content, created_at)
SELECT c.id, 'ai', 'The final total is $2,874.75. Your insurance has approved the full amount minus your $500 deductible. You''ll owe $500 at pickup.', NOW() - INTERVAL '4 days' + INTERVAL '7 minutes'
FROM conversations c JOIN users u ON c.user_id = u.id WHERE u.email = 'demo@collisionai.com';
