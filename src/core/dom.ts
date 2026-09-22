export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Fades out the loading screen; also called on failure so it can never hang. */
export const hideLoadingScreen = () => {
 const screen = $('loading-screen');
 screen.classList.add('fade-out');
 setTimeout(() => { screen.style.display = 'none'; }, 700);
};

/** Brings the loading screen back for a map switch that happens without a reload. */
export const showLoadingScreen = () => {
 const screen = $('loading-screen');
 screen.style.display = '';
 screen.classList.remove('fade-out');
};
