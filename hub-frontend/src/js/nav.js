// EVOSHUB — Navigation
const hamburger = document.querySelector('.hamburger')
const navLinks  = document.querySelector('.nav-links')

hamburger?.addEventListener('click', () => {
  navLinks.classList.toggle('nav-links--open')
})

navLinks?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => navLinks.classList.remove('nav-links--open'))
})

// Active highlight on scroll
const sections = document.querySelectorAll('section[id]')
const links    = document.querySelectorAll('.nav-links a')

window.addEventListener('scroll', () => {
  let current = ''
  sections.forEach(s => { if (window.scrollY >= s.offsetTop - 100) current = s.id })
  links.forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + current)
  })
}, { passive: true })
