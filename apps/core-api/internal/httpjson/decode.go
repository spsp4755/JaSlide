package httpjson

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

func Decode(request *http.Request, writer http.ResponseWriter, limit int64, value any) error {
	var reader io.Reader = io.LimitReader(request.Body, limit+1)
	if writer != nil {
		reader = http.MaxBytesReader(writer, request.Body, limit)
	}
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON document")
		}
		return err
	}
	return nil
}
