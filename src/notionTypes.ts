export interface NotionBlock {
  type: 'heading' | 'paragraph' | 'bullets' | 'table';
  text?: string;
  items?: string[];
  table?: {
    headers: string[];
    rows: string[][];
  };
}

export interface NotionPageSummary {
  id: string;
  title: string;
  lastEdited: string;
}

export interface NotionPageContent {
  id: string;
  title: string;
  lastEdited: string;
  blocks: NotionBlock[];
}
