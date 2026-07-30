package admin

import (
	"reflect"
	"runtime"
	"testing"
)

func TestActiveAdminResponseContracts(t *testing.T) {
	document := map[string]any{"id": "doc-1", "_slideCount": int64(3)}
	addCountContract(document, map[string]string{"slides": "_slideCount"})
	if !reflect.DeepEqual(document["_count"], map[string]int64{"slides": 3}) {
		t.Fatalf("document _count = %#v", document["_count"])
	}
	if _, exists := document["_slideCount"]; exists {
		t.Fatal("document leaked internal count field")
	}

	organization := map[string]any{
		"id": "org-1", "_userCount": int64(2), "_templateCount": int64(4), "_assetCount": int64(6),
	}
	addCountContract(organization, map[string]string{
		"users": "_userCount", "templates": "_templateCount", "assets": "_assetCount",
	})
	if !reflect.DeepEqual(organization["_count"], map[string]int64{
		"users": 2, "templates": 4, "assets": 6,
	}) {
		t.Fatalf("organization _count = %#v", organization["_count"])
	}

	stats := dashboardStatsContract(10, 3, 20, 8, 2)
	if !reflect.DeepEqual(stats, map[string]any{
		"totalUsers": 10, "activeUsers": 3, "totalPresentations": 20,
		"totalGenerations": 8, "errorRate": float64(25),
	}) {
		t.Fatalf("dashboard stats = %#v", stats)
	}

	jobStats := jobStatsContract([]map[string]any{
		{"status": "FAILED", "count": int64(2)},
		{"status": "COMPLETED", "count": int64(5)},
	}, 4)
	if !reflect.DeepEqual(jobStats, map[string]any{
		"byStatus": []map[string]any{
			{"status": "FAILED", "_count": int64(2)},
			{"status": "COMPLETED", "_count": int64(5)},
		},
		"last24Hours": int64(4),
	}) {
		t.Fatalf("job stats = %#v", jobStats)
	}

	if got := forceStopContract(7); !reflect.DeepEqual(got, map[string]any{
		"success": true, "affectedJobs": int64(7),
	}) {
		t.Fatalf("force stop = %#v", got)
	}
	if got := modelTestSuccess("Local model", 12); !reflect.DeepEqual(got, map[string]any{
		"success": true, "model": "Local model", "responseTime": int64(12),
		"message": "Model endpoint is reachable",
	}) {
		t.Fatalf("model test = %#v", got)
	}
}

func TestOperationsMemoryContractUsesMegabytes(t *testing.T) {
	got := memoryContract(runtime.MemStats{HeapAlloc: 2 << 20, HeapSys: 3 << 20, Sys: 4 << 20})
	want := map[string]uint64{"heapUsed": 2, "heapTotal": 3, "rss": 4}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("memory = %#v, want %#v", got, want)
	}
}

func TestAdminRoleIntent(t *testing.T) {
	for _, role := range []string{"ADMIN", "SYSTEM_ADMIN"} {
		if !isAdminRole(role) {
			t.Errorf("%s should have admin access", role)
		}
	}
	for _, role := range []string{"USER", "AUDITOR", "OPERATOR", "ORG_ADMIN"} {
		if isAdminRole(role) {
			t.Errorf("%s should not have system admin access", role)
		}
	}
}
