export type TriviaCategory = 'science' | 'geography' | 'history' | 'tech' | 'general';

export interface TriviaQuestion {
  category: TriviaCategory;
  question: string;
  /** First entry is the correct answer; options are shuffled at runtime. */
  answers: [string, string, string, string];
}

export const CATEGORY_LABELS: Record<TriviaCategory, string> = {
  science: 'Science',
  geography: 'Geography',
  history: 'History',
  tech: 'Tech',
  general: 'General knowledge',
};

export const TRIVIA: TriviaQuestion[] = [
  // Science
  { category: 'science', question: 'Which gas do plants absorb from the air for photosynthesis?', answers: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'] },
  { category: 'science', question: 'What is the chemical symbol for gold?', answers: ['Au', 'Ag', 'Gd', 'Go'] },
  { category: 'science', question: 'How many bones are in the adult human body?', answers: ['206', '186', '212', '230'] },
  { category: 'science', question: 'Which planet is known as the Red Planet?', answers: ['Mars', 'Jupiter', 'Venus', 'Mercury'] },
  { category: 'science', question: 'What is the hardest naturally occurring substance?', answers: ['Diamond', 'Quartz', 'Granite', 'Topaz'] },
  { category: 'science', question: 'Roughly how fast does light travel in a vacuum?', answers: ['300,000 km/s', '30,000 km/s', '3,000,000 km/s', '150,000 km/s'] },
  { category: 'science', question: 'Which organ produces insulin?', answers: ['Pancreas', 'Liver', 'Kidney', 'Spleen'] },
  { category: 'science', question: "What is the most abundant gas in Earth's atmosphere?", answers: ['Nitrogen', 'Oxygen', 'Argon', 'Carbon dioxide'] },
  { category: 'science', question: 'At sea level, water boils at what temperature?', answers: ['100 °C', '90 °C', '110 °C', '120 °C'] },
  { category: 'science', question: 'Where is most of the DNA stored in an animal cell?', answers: ['Nucleus', 'Ribosome', 'Cell membrane', 'Golgi apparatus'] },
  { category: 'science', question: 'Which force keeps the planets in orbit around the Sun?', answers: ['Gravity', 'Magnetism', 'Friction', 'Static electricity'] },
  { category: 'science', question: 'What is the smallest planet in our solar system?', answers: ['Mercury', 'Mars', 'Venus', 'Earth'] },
  // Geography
  { category: 'geography', question: 'What is the capital of Australia?', answers: ['Canberra', 'Sydney', 'Melbourne', 'Perth'] },
  { category: 'geography', question: 'What is the largest ocean on Earth?', answers: ['Pacific', 'Atlantic', 'Indian', 'Arctic'] },
  { category: 'geography', question: 'What is the capital of Canada?', answers: ['Ottawa', 'Toronto', 'Vancouver', 'Montreal'] },
  { category: 'geography', question: 'Mount Everest sits on the border of Nepal and which other country?', answers: ['China', 'India', 'Bhutan', 'Pakistan'] },
  { category: 'geography', question: 'What is the largest hot desert in the world?', answers: ['Sahara', 'Arabian', 'Gobi', 'Kalahari'] },
  { category: 'geography', question: 'How many continents are there in the most common model?', answers: ['7', '5', '6', '8'] },
  { category: 'geography', question: 'What is the capital of Japan?', answers: ['Tokyo', 'Kyoto', 'Osaka', 'Hiroshima'] },
  { category: 'geography', question: 'Which river flows through Paris?', answers: ['Seine', 'Loire', 'Rhône', 'Thames'] },
  { category: 'geography', question: 'In which country is Machu Picchu?', answers: ['Peru', 'Chile', 'Bolivia', 'Ecuador'] },
  { category: 'geography', question: 'Which is the largest country by area?', answers: ['Russia', 'Canada', 'China', 'United States'] },
  { category: 'geography', question: 'What is the capital of Brazil?', answers: ['Brasília', 'Rio de Janeiro', 'São Paulo', 'Salvador'] },
  { category: 'geography', question: 'Which strait separates Spain from Morocco?', answers: ['Strait of Gibraltar', 'Bosporus', 'Strait of Hormuz', 'Strait of Magellan'] },
  // History
  { category: 'history', question: 'In which year did humans first land on the Moon?', answers: ['1969', '1965', '1972', '1959'] },
  { category: 'history', question: 'Who was the first President of the United States?', answers: ['George Washington', 'Thomas Jefferson', 'John Adams', 'Abraham Lincoln'] },
  { category: 'history', question: 'In which year did the Berlin Wall fall?', answers: ['1989', '1991', '1985', '1979'] },
  { category: 'history', question: 'Which of the Seven Wonders of the Ancient World still stands?', answers: ['Great Pyramid of Giza', 'Colossus of Rhodes', 'Hanging Gardens of Babylon', 'Lighthouse of Alexandria'] },
  { category: 'history', question: 'Who painted the Mona Lisa?', answers: ['Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Botticelli'] },
  { category: 'history', question: 'In which year did World War II end?', answers: ['1945', '1944', '1946', '1939'] },
  { category: 'history', question: 'Julius Caesar was a leader of which ancient civilization?', answers: ['Rome', 'Greece', 'Egypt', 'Persia'] },
  { category: 'history', question: 'Who introduced movable-type printing to Europe around 1440?', answers: ['Johannes Gutenberg', 'Isaac Newton', 'Galileo Galilei', 'Leonardo da Vinci'] },
  { category: 'history', question: 'In which year did the Titanic sink?', answers: ['1912', '1905', '1920', '1898'] },
  { category: 'history', question: 'Who was the first person to travel into space?', answers: ['Yuri Gagarin', 'Neil Armstrong', 'John Glenn', 'Alan Shepard'] },
  { category: 'history', question: 'In which year was the Magna Carta sealed?', answers: ['1215', '1066', '1492', '1776'] },
  { category: 'history', question: 'What was the capital of the Byzantine Empire?', answers: ['Constantinople', 'Athens', 'Rome', 'Alexandria'] },
  // Tech
  { category: 'tech', question: 'What does CPU stand for?', answers: ['Central Processing Unit', 'Computer Power Unit', 'Core Program Utility', 'Central Peripheral Unit'] },
  { category: 'tech', question: 'What does HTML stand for?', answers: ['HyperText Markup Language', 'High Transfer Machine Language', 'Hyperlink Text Management Language', 'Home Tool Markup Language'] },
  { category: 'tech', question: 'Who co-founded Microsoft with Paul Allen?', answers: ['Bill Gates', 'Steve Jobs', 'Steve Wozniak', 'Larry Page'] },
  { category: 'tech', question: 'How many bits are in a byte?', answers: ['8', '4', '16', '32'] },
  { category: 'tech', question: 'In which year was the first iPhone released?', answers: ['2007', '2005', '2008', '2010'] },
  { category: 'tech', question: 'What does HTTP stand for?', answers: ['HyperText Transfer Protocol', 'High Throughput Transfer Process', 'Hosted Text Transport Protocol', 'HyperText Transmission Program'] },
  { category: 'tech', question: 'Which language runs natively in every major web browser?', answers: ['JavaScript', 'Python', 'C++', 'Java'] },
  { category: 'tech', question: 'What does RAM stand for?', answers: ['Random Access Memory', 'Read And Modify', 'Rapid Application Memory', 'Remote Access Module'] },
  { category: 'tech', question: 'What is the binary number 1010 in decimal?', answers: ['10', '12', '8', '5'] },
  { category: 'tech', question: 'What does URL stand for?', answers: ['Uniform Resource Locator', 'Universal Routing Link', 'User Reference Line', 'Unified Resource Library'] },
  { category: 'tech', question: 'Who created the Linux kernel?', answers: ['Linus Torvalds', 'Richard Stallman', 'Dennis Ritchie', 'Ken Thompson'] },
  { category: 'tech', question: 'Wi-Fi is based on which family of IEEE standards?', answers: ['802.11', '802.3', '802.15', '802.1'] },
  // General
  { category: 'general', question: 'What are the primary colors of light?', answers: ['Red, green, blue', 'Red, yellow, blue', 'Cyan, magenta, yellow', 'Red, green, yellow'] },
  { category: 'general', question: 'How many sides does a hexagon have?', answers: ['6', '5', '7', '8'] },
  { category: 'general', question: 'How many minutes are in a day?', answers: ['1,440', '1,200', '1,560', '1,340'] },
  { category: 'general', question: 'What is the largest mammal on Earth?', answers: ['Blue whale', 'African elephant', 'Giraffe', 'Sperm whale'] },
  { category: 'general', question: 'A standard modern piano has how many keys?', answers: ['88', '76', '96', '64'] },
  { category: 'general', question: 'How many players does each soccer team have on the field?', answers: ['11', '10', '9', '12'] },
  { category: 'general', question: 'Which language has the most native speakers?', answers: ['Mandarin Chinese', 'English', 'Spanish', 'Hindi'] },
  { category: 'general', question: 'At what temperature in Fahrenheit does water freeze?', answers: ['32 °F', '0 °F', '212 °F', '100 °F'] },
  { category: 'general', question: 'Who wrote "Romeo and Juliet"?', answers: ['William Shakespeare', 'Charles Dickens', 'Jane Austen', 'Christopher Marlowe'] },
  { category: 'general', question: 'What is the square root of 144?', answers: ['12', '14', '11', '16'] },
  { category: 'general', question: 'How many hours are in a week?', answers: ['168', '144', '172', '160'] },
  { category: 'general', question: 'What is the currency of Japan?', answers: ['Yen', 'Won', 'Yuan', 'Ringgit'] },
];
