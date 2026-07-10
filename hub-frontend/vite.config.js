import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/pages',
  publicDir: '../../public',
  build: {
    outDir: '../../dist',
    rollupOptions: {
      input: {
        main:              'src/pages/index.html',
        about:             'src/pages/about.html',
        services:          'src/pages/services.html',
        contact:           'src/pages/contact.html',
        websiteCreation:   'src/pages/website-creation.html',
        adminLogin:        'src/pages/admin-login.html',
        adminWebsiteChat:  'src/pages/admin-website-chat.html',
        notFound:          'src/pages/404.html',
      }
    }
  }
})
