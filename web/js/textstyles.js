// Готовые стили текста (вкладка «Текст», свои тексты пресетов).
export const TEXT_STYLES = [
  { name: 'Классика', style: { font: 'Rubik-700' } },
  { name: 'Жёлтый', style: { font: 'Rubik-800', color: '#FFE14D', strokeWidth: 8 } },
  { name: 'Плашка', style: { font: 'Onest-700', box: true, boxColor: '#000000', boxAlpha: 0.7, boxPad: 16, shadowAlpha: 0 } },
  { name: 'Белая плашка', style: { font: 'Rubik-700', color: '#111111', box: true, boxColor: '#FFFFFF', boxAlpha: 1, boxPad: 14, shadowAlpha: 0 } },
  { name: 'Неон', style: { font: 'Unbounded-900', color: '#19F5FF', strokeColor: '#0A0F3C', strokeWidth: 6, shadowColor: '#FF2BD6', shadowAlpha: 0.9, shadowDist: 5 } },
  { name: 'Комикс', style: { font: 'DelaGothicOne-400', strokeColor: '#E8102E', strokeWidth: 9, shadowAlpha: 0.8, shadowDist: 8 } },
  { name: 'Мем', style: { font: 'RubikMonoOne-400', strokeWidth: 9, upper: true } },
  { name: 'Игровой', style: { font: 'PressStart2P-400', size: 44, color: '#7CFF4F', strokeWidth: 6 } },
  { name: 'Мягкий', style: { font: 'MPLUSRounded1c-800', strokeWidth: 7 } },
  { name: 'Рукописный', style: { font: 'Caveat-700', size: 80, strokeWidth: 5 } },
  { name: 'Глитч', style: { font: 'RubikGlitch-400', strokeWidth: 5 } },
  { name: 'Элегант', style: { font: 'PlayfairDisplay-900', strokeWidth: 0, shadowAlpha: 0.8, shadowDist: 4 } },
  // как в эдитах
  { name: 'Заголовок эдита', style: { font: 'Oranienbaum-400', size: 150, strokeWidth: 0, shadowColor: '#000000', shadowAlpha: 0.75, shadowDist: 6, upper: true, wrap: 12 } },
  { name: 'Граффити', style: { font: 'RubikSprayPaint-400', size: 120, strokeColor: '#000000', strokeWidth: 6, shadowAlpha: 0.6, shadowDist: 5, upper: true, wrap: 12 } },
  { name: 'Переписка', text: 'у нас отношения или дружба?\n> не знаю\nа ты чего хочешь?', style: { font: 'Onest-500', size: 50, chat: true, chatBg: true, strokeWidth: 0, shadowAlpha: 0, wrap: 0 } },
];
