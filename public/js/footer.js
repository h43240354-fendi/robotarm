document.addEventListener('DOMContentLoaded', () => {

  const currentPath = window.location.pathname;

  const navItems = document.querySelectorAll('.nav-item');

  navItems.forEach(item => {

    const page = item.dataset.page;

    if (
      currentPath === page ||
      (currentPath === '/' && page === '/home')
    ) {
      item.classList.add('active');
    }

    item.addEventListener('click', () => {
      window.location.href = page;
    });

  });

});