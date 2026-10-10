'use client';

import { useQuery } from '@tanstack/react-query';
import { Container, Section, SectionHeading } from '@/components/ui/layout.tsx';
import { Notice } from '@/components/ui/notice.tsx';
import { ErrorState, LoadingRows } from '@/components/ui/states.tsx';
import type { HealthReport } from '@/lib/binance/wire.ts';

/**
 * What the Binance Web3 API is doing, endpoint by endpoint.
 *
 * This page exists because of how the integration was built. The network path to
 * `web3.binance.com` was filtered from the development machine for the entire
 * time the client was written — DNS first, then the connection itself — so every
 * question about the API had to be asked from somewhere else and answered by
 * inference. A panel that names each endpoint, its status, its latency and the
 * API's own error code is the instrument that was missing.
 *
 * It is also the honest way to show the integration in a demo. Every other
 * surface of this application shows reference prices as part of something else,
 * where a failure is a quiet empty column. Here a failure is the subject, and a
 * judge can watch the five endpoints answer — or watch them not.
 *
 * It exposes no secret. The key is never echoed back, and the body excerpt is
 * truncated by the route before it is ever sent.
 */
export default function DiagnosticsPage() {
  const report = useQuery({
    queryKey: ['binance', 'health'],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async (): Promise<HealthReport> => {
      const response = await fetch('/api/reference/health', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`The diagnostics route answered ${response.status}.`);
      }
      return (await response.json()) as HealthReport;
    },
  });

  return (
    <Section className="pt-12 pb-20 sm:pt-16">
      <Container width="wide">
        <SectionHeading
          title="Binance Web3 API"
          description="Each endpoint this application calls, called for real, with whatever the API said back."
        />

        {report.isPending ? <LoadingRows rows={5} /> : null}

        {report.isError ? (
          <ErrorState
            title="The diagnostics route did not answer"
            detail="This page reads its own Route Handler, so a failure here is a defect in this application rather than at Binance."
            raw={report.error instanceof Error ? report.error.message : undefined}
            onRetry={() => void report.refetch()}
          />
        ) : null}

        {report.data && !report.data.configured ? (
          <Notice tone="neutral" title="No credentials on this deployment">
            This deployment has no Binance Web3 API key pair, so there is nothing to probe. Set{' '}
            <code>BINANCE_WEB3_API_KEY</code> and <code>BINANCE_WEB3_API_SECRET</code> in{' '}
            <code>apps/web/.env.local</code> — never with a <code>NEXT_PUBLIC_</code> prefix, which
            would publish them to every visitor — and reload this page.
          </Notice>
        ) : null}

        {report.data?.configured ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-t border-rule">
                <caption className="sr-only">
                  Each Binance Web3 API endpoint this application calls, with its result.
                </caption>
                <thead>
                  <tr className="border-b border-rule">
                    <th scope="col" className="label py-2.5 pr-4 text-left font-medium">
                      Endpoint
                    </th>
                    <th scope="col" className="label py-2.5 pr-4 text-left font-medium">
                      Result
                    </th>
                    <th scope="col" className="label py-2.5 pr-4 text-right font-medium">
                      Latency
                    </th>
                    <th scope="col" className="label py-2.5 text-left font-medium">
                      What it said
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.probes.map((probe) => (
                    <tr key={probe.endpoint} className="border-b border-rule last:border-0">
                      <th
                        scope="row"
                        className="figure py-3 pr-4 text-left align-top text-xs font-normal text-ink"
                      >
                        {probe.endpoint}
                      </th>

                      <td className="py-3 pr-4 align-top">
                        <span
                          className={`figure text-xs ${probe.ok ? 'text-positive' : 'text-negative'}`}
                        >
                          {probe.ok
                            ? `HTTP ${probe.status}`
                            : probe.status
                              ? `HTTP ${probe.status}`
                              : 'no answer'}
                        </span>
                      </td>

                      <td className="figure py-3 pr-4 text-right align-top text-xs text-ink-muted">
                        {probe.ms} ms
                      </td>

                      <td className="py-3 align-top text-xs text-ink-muted">
                        {probe.code ? (
                          <span className="figure text-negative">code {probe.code} · </span>
                        ) : null}
                        {probe.message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-faint">
              Probed at{' '}
              {new Date(report.data.fetchedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC.
              Each request is signed with HMAC-SHA256 over{' '}
              <code>timestamp + method + requestPath + body</code>, where <code>requestPath</code>{' '}
              includes the <code>/build</code> prefix. Failures are reported with the API&apos;s own
              error code rather than a paraphrase, because the code is the part that identifies the
              problem.
            </p>
          </>
        ) : null}
      </Container>
    </Section>
  );
}
