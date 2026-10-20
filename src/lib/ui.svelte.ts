// Page-wide things any component may open: how to play (from the start page, the lobby, the table's
// settings; once on a device's first visit).

export const ui = $state<{ guide: boolean }>({ guide: false });
