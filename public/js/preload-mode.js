try {
  if (localStorage.getItem('orangesea-startup-fast-skip-v1') === '1') {
    document.documentElement.classList.add('startup-fast-skip-preload');
  }
  document.documentElement.classList.add(localStorage.getItem('orangesea-diy-player-mode-v1') === '1' ? 'diy-mode-preload' : 'simple-mode-preload');
  var genreModePreload = localStorage.getItem('orangesea-genre-mode-v1') === '1';
  var filmRadioPreload = localStorage.getItem('orangesea-film-radio-v1') === '1';
  if (genreModePreload) {
    document.documentElement.classList.add('genre-mode-preload');
  } else if (filmRadioPreload) {
    document.documentElement.classList.add('film-radio-preload');
  }
} catch (e) {
  document.documentElement.classList.add('simple-mode-preload');
}
