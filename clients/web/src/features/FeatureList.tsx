/**
 * FeatureList — features list surface (Story 001 T1).
 *
 * Receives daemon read state from FeatureListContainer.
 * Renders loading / error via ListPage state slots (DataStates, DESIGN §7).
 * Renders an explicit feature-scoped empty state (locators.features.list.empty)
 * so the E2E and component tests can distinguish "no features" from the
 * shared DataStates empty (DESIGN §8 area-scoped locators).
 *
 * Rows carry locators.features.list.row — one per feature.
 * Status column renders via FeatureStatusBadge (DESIGN §4 domain badge).
 */
import { Link } from "react-router-dom";
import { ListPage } from "@/components/templates/ListPage";
import { FeatureStatusBadge } from "@/components/status/FeatureStatusBadge";
import { ROUTES } from "@/app/routes";
import { Empty } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { locators } from "@/locators";

interface Feature {
  featureId: string;
  name: string;
  status: string;
  phase: string;
  progressSummary: string;
}

export interface FeatureListProps {
  loading?: boolean;
  error?: { message: string };
  refreshError?: { message: string };
  features?: readonly Feature[];
  fetchedAt?: Date;
  onRefresh?: () => Promise<void>;
}

export function FeatureList({ loading, error, refreshError, features, fetchedAt, onRefresh }: FeatureListProps = {}) {
  const resolvedFeatures = features ?? [];
  return (
    <ListPage
      title="Features"
      loading={loading}
      error={error}
      refreshError={refreshError}
      fetchedAt={fetchedAt}
      onRefresh={onRefresh}
    >
      {!loading && error === undefined &&
        (resolvedFeatures.length === 0 ? (
          <Empty data-testid={locators.features.list.empty}>
            No features found.
          </Empty>
        ) : (
          <Table data-testid={locators.features.list.table}>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resolvedFeatures.map((feature) => (
                <TableRow
                  key={feature.featureId}
                  data-testid={locators.features.list.row}
                >
                  <TableCell>
                    <Link
                      to={ROUTES.featureDetailPath(feature.featureId)}
                      data-testid={locators.features.list.link(feature.featureId)}
                    >
                      {feature.featureId}
                    </Link>
                  </TableCell>
                  <TableCell>{feature.name}</TableCell>
                  <TableCell>
                    <FeatureStatusBadge status={feature.status} />
                  </TableCell>
                  <TableCell>{feature.phase}</TableCell>
                  <TableCell>{feature.progressSummary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
    </ListPage>
  );
}
