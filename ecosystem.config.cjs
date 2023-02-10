module.exports = {
  apps: [
    {
      name: 'chatgptbot',
      script: 'npx tsx src/index.ts',
      cron_restart: '0 */4 * * *', // once every 4 hours
      env: {
        NODE_ENV: 'development',
        HEADLESS: 'true'
      },
      env_production: {
        NODE_ENV: 'production',
        HEADLESS: 'true'
      }
    }
  ]
}
