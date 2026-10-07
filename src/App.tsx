import { useState, useEffect } from 'react';
import {
  FileText,
  ArrowRight,
  Loader2,
  Download,
  CheckCircle2,
  AlertCircle,
  File as FileIcon,
} from 'lucide-react';
import { generatePdf } from './generatePdf';
import type { NotionPageContent } from './notionTypes';
import {
  startNotionOAuth,
  parseCallbackParams,
  fetchNotionPages,
  fetchNotionPageContent,
  type NotionConnection,
  type NotionPageSummary,
} from './notionOauth';

type Step = 'landing' | 'connecting' | 'connected' | 'select' | 'generating' | 'ready' | 'error';

export default function App() {
  const [step, setStep] = useState<Step>('landing');
  const [connection, setConnection] = useState<NotionConnection | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [pages, setPages] = useState<NotionPageSummary[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState('');
  const [selectedPage, setSelectedPage] = useState<NotionPageSummary | null>(null);
  const [pageContent, setPageContent] = useState<NotionPageContent | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#callback')) {
      const queryStr = hash.slice('#callback'.length).replace(/^\?/, '');
      const result = parseCallbackParams(queryStr);

      if (result.ok) {
        setConnection(result.data);
        setStep('connected');
      } else {
        if (result.error === 'access_denied') {
          setErrorMsg('You cancelled the Notion authorization. You can try again anytime.');
        } else if (result.error === 'missing_code' || result.error === 'no_token') {
          setErrorMsg('The authorization callback did not include a valid token. Please try again.');
        } else if (result.error === 'token_exchange') {
          setErrorMsg('Notion rejected the authorization code. Please try connecting again.');
        } else if (result.error === 'server_config') {
          setErrorMsg('The server is missing Notion OAuth credentials. Make sure the secrets are configured.');
        } else if (result.error === 'server_error') {
          setErrorMsg(result.description ?? 'An unexpected server error occurred during authorization. Please try again.');
        } else {
          setErrorMsg(result.description ?? 'Authorization failed for an unknown reason.');
        }
        setStep('error');
      }

      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const handleGetStarted = () => {
    try {
      startNotionOAuth();
      setStep('connecting');
    } catch {
      setErrorMsg('Notion OAuth is not configured on the server. Make sure NOTION_CLIENT_ID is set in the project secrets.');
      setStep('error');
    }
  };

  const handleSelectPage = () => {
    if (!connection) return;
    setPagesLoading(true);
    setPagesError('');
    setPages([]);
    setSelectedPage(null);
    setStep('select');
    fetchNotionPages(connection.tokenId)
      .then((result) => {
        setPages(result);
        if (result.length === 0) {
          setPagesError('No pages found. Make sure you have shared pages with the integration in Notion.');
        }
      })
      .catch((err) => {
        setPagesError(err.message ?? 'Failed to load pages from Notion.');
      })
      .finally(() => setPagesLoading(false));
  };

  const handleGenerate = async () => {
    if (!connection || !selectedPage) return;
    setStep('generating');
    try {
      const content = await fetchNotionPageContent(connection.tokenId, selectedPage.id);
      setPageContent(content);
      generatePdf(content);
      setStep('ready');
    } catch (err) {
      setErrorMsg(err.message ?? 'Failed to retrieve page content from Notion.');
      setStep('error');
    }
  };

  const handleDownloadAgain = () => {
    if (pageContent) generatePdf(pageContent);
  };

  const reset = () => {
    setSelectedPage(null);
    setPageContent(null);
    setStep(connection ? 'connected' : 'landing');
  };

  const fullReset = () => {
    setSelectedPage(null);
    setPageContent(null);
    setConnection(null);
    setPages([]);
    setStep('landing');
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center gap-2">
          <button onClick={fullReset} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white">
              <FileText size={18} />
            </div>
            <span className="font-semibold tracking-tight">Notion PDF</span>
          </button>
          {connection && (
            <span className="ml-auto flex items-center gap-2 text-sm text-gray-500">
              <span className="flex h-2 w-2 rounded-full bg-green-500" />
              Connected{connection.workspaceName ? `: ${connection.workspaceName}` : ''}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        {step === 'landing' && (
          <div className="max-w-xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Turn your Notion pages into clean, professional PDFs.
            </h1>
            <p className="mt-5 text-lg text-gray-500">
              Select a page and generate a printable PDF in seconds.
            </p>
            <button
              onClick={handleGetStarted}
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white font-medium transition-colors hover:bg-gray-800 active:bg-gray-700"
            >
              Get Started
              <ArrowRight size={18} />
            </button>
            <p className="mt-4 text-xs text-gray-400">
              You'll be asked to connect your Notion account.
            </p>
          </div>
        )}

        {step === 'connecting' && (
          <div className="max-w-sm text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center">
              <Loader2 size={40} className="animate-spin text-gray-400" />
            </div>
            <h2 className="mt-6 text-xl font-semibold text-gray-900">
              Redirecting to Notion…
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              You'll be taken to Notion to authorize access to your pages.
            </p>
          </div>
        )}

        {step === 'connected' && (
          <div className="max-w-md text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
              <CheckCircle2 size={32} className="text-green-600" />
            </div>
            <h2 className="mt-6 text-2xl font-bold text-gray-900">
              Notion connected
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {connection?.workspaceName
                ? `Your workspace "${connection.workspaceName}" is connected.`
                : 'Your Notion account is connected.'}
            </p>
            <button
              onClick={handleSelectPage}
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white font-medium transition-colors hover:bg-gray-800 active:bg-gray-700"
            >
              Select a page
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {step === 'select' && (
          <div className="w-full max-w-lg">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              Select a page
            </h2>
            <p className="mt-1.5 text-sm text-gray-500">
              Choose a Notion page to export as a PDF.
            </p>

            {pagesLoading && (
              <div className="mt-8 flex items-center justify-center gap-2 text-sm text-gray-400">
                <Loader2 size={20} className="animate-spin" />
                Loading pages from Notion…
              </div>
            )}

            {pagesError && !pagesLoading && (
              <div className="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-4">
                <p className="text-sm text-gray-600">{pagesError}</p>
                <button
                  onClick={handleSelectPage}
                  className="mt-3 text-sm font-medium text-gray-900 hover:text-gray-700"
                >
                  Retry
                </button>
              </div>
            )}

            {!pagesLoading && !pagesError && pages.length > 0 && (
              <ul className="mt-6 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
                {pages.map((page) => {
                  const isSelected = selectedPage?.id === page.id;
                  return (
                    <li key={page.id}>
                      <button
                        onClick={() => setSelectedPage(page)}
                        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                          isSelected ? 'bg-gray-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                          <FileIcon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            {page.title}
                          </div>
                          <div className="text-xs text-gray-400">
                            Last edited {page.lastEdited}
                          </div>
                        </div>
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            isSelected
                              ? 'border-gray-900 bg-gray-900'
                              : 'border-gray-300'
                          }`}
                        >
                          {isSelected && (
                            <div className="h-2 w-2 rounded-full bg-white" />
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {!pagesLoading && !pagesError && pages.length === 0 && (
              <div className="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-4">
                <p className="text-sm text-gray-600">
                  No pages found. In Notion, open a page, click the "..." menu, and select "Connect to" to share it with your integration.
                </p>
                <button
                  onClick={handleSelectPage}
                  className="mt-3 text-sm font-medium text-gray-900 hover:text-gray-700"
                >
                  Refresh
                </button>
              </div>
            )}

            {selectedPage && (
              <div className="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-4">
                <p className="text-sm text-gray-500">Selected</p>
                <p className="mt-0.5 font-semibold text-gray-900">
                  {selectedPage.title}
                </p>
                <button
                  onClick={handleGenerate}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white font-medium transition-colors hover:bg-gray-800 active:bg-gray-700"
                >
                  Generate PDF
                  <ArrowRight size={18} />
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'generating' && (
          <div className="max-w-sm text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center">
              <Loader2 size={40} className="animate-spin text-gray-400" />
            </div>
            <h2 className="mt-6 text-xl font-semibold text-gray-900">
              Generating your PDF…
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Fetching {selectedPage?.title} from Notion and formatting into a clean document.
            </p>
          </div>
        )}

        {step === 'ready' && (
          <div className="max-w-sm text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
              <CheckCircle2 size={32} className="text-green-600" />
            </div>
            <h2 className="mt-6 text-2xl font-bold text-gray-900">
              Your PDF is ready.
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {selectedPage?.title} has been downloaded to your device.
            </p>
            <button
              onClick={handleDownloadAgain}
              className="mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white font-medium transition-colors hover:bg-gray-800 active:bg-gray-700"
            >
              <Download size={18} />
              Download PDF
            </button>
            <button
              onClick={reset}
              className="mt-3 block w-full text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Export another page
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="max-w-md text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
              <AlertCircle size={32} className="text-red-600" />
            </div>
            <h2 className="mt-6 text-2xl font-bold text-gray-900">
              Something went wrong
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {errorMsg}
            </p>
            <button
              onClick={() => setStep(connection ? 'connected' : 'landing')}
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white font-medium transition-colors hover:bg-gray-800 active:bg-gray-700"
            >
              Try again
              <ArrowRight size={18} />
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4 text-center text-xs text-gray-400">
          Notion PDF — connected to your Notion workspace
        </div>
      </footer>
    </div>
  );
}
