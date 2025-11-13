/**
 * Real-time news article with associated market symbols.
 */
export interface LiveNews {
  /** News article title */
  title: string;

  /** Full article content */
  content: string;

  /** Related stock ticker symbols */
  symbols?: string[];

  /** Publication timestamp */
  timestamp: Date;
}
