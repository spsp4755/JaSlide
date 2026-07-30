package httpjson

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeRejectsTrailingJSONAndUnknownFields(t *testing.T) {
	for _, body := range []string{
		`{"name":"ok"} {"second":true}`,
		`{"name":"ok","unexpected":true}`,
	} {
		request := httptest.NewRequest("POST", "/", strings.NewReader(body))
		var input struct {
			Name string `json:"name"`
		}
		if err := Decode(request, nil, 1024, &input); err == nil {
			t.Fatalf("expected strict decode to reject %s", body)
		}
	}
}

func TestDecodeAcceptsSingleJSONDocument(t *testing.T) {
	request := httptest.NewRequest("POST", "/", strings.NewReader("{\"name\":\"ok\"}\n"))
	var input struct {
		Name string `json:"name"`
	}
	if err := Decode(request, nil, 1024, &input); err != nil {
		t.Fatal(err)
	}
	if input.Name != "ok" {
		t.Fatalf("unexpected input: %+v", input)
	}
}
