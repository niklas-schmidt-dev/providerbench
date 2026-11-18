package digitalocean

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/digitalocean/godo"
)

type godoCloud struct {
	client *godo.Client
}

// NewCloud uses DigitalOcean's official Godo SDK. The token remains in the
// environment and never appears in process arguments or reports.
func NewCloud(token string) Cloud {
	return &godoCloud{client: godo.NewFromToken(token)}
}

func (c *godoCloud) ListSizes(ctx context.Context) ([]Size, error) {
	options := &godo.ListOptions{PerPage: 200}
	var result []Size
	for {
		sizes, response, err := c.client.Sizes.List(ctx, options)
		if err != nil {
			return nil, err
		}
		for _, size := range sizes {
			result = append(result, Size{
				Slug:         size.Slug,
				Description:  size.Description,
				Memory:       size.Memory,
				VCPUs:        size.Vcpus,
				PriceHourly:  size.PriceHourly,
				PriceMonthly: size.PriceMonthly,
				Regions:      append([]string(nil), size.Regions...),
				Available:    size.Available,
			})
		}
		if response == nil || response.Links == nil || response.Links.IsLastPage() {
			break
		}
		page, err := response.Links.CurrentPage()
		if err != nil {
			return nil, err
		}
		options.Page = page + 1
	}
	return result, nil
}

func (c *godoCloud) CreateDroplets(ctx context.Context, opts CreateDropletsOptions) ([]Server, error) {
	droplets, _, err := c.client.Droplets.CreateMultiple(ctx, &godo.DropletMultiCreateRequest{
		Names:   append([]string(nil), opts.Names...),
		Region:  opts.Region,
		Size:    opts.Size,
		Image:   godo.DropletCreateImage{Slug: opts.Image},
		SSHKeys: []godo.DropletCreateSSHKey{{Fingerprint: opts.SSHKeyFingerprint}},
		Tags:    append([]string(nil), opts.Tags...),
	})
	servers := make([]Server, 0, len(droplets))
	for _, droplet := range droplets {
		servers = append(servers, serverFromDroplet(&droplet))
	}
	if err != nil {
		return servers, err
	}

	for index, droplet := range droplets {
		ready, waitErr := c.waitForDroplet(ctx, droplet.ID)
		if ready != nil {
			servers[index] = serverFromDroplet(ready)
		}
		if waitErr != nil {
			return servers, fmt.Errorf("wait for Droplet %s: %w", droplet.Name, waitErr)
		}
	}
	return servers, nil
}

func (c *godoCloud) waitForDroplet(ctx context.Context, id int) (*godo.Droplet, error) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		droplet, _, err := c.client.Droplets.Get(ctx, id)
		if err != nil {
			return droplet, err
		}
		if droplet != nil && droplet.Status == "active" {
			ip, ipErr := droplet.PublicIPv4()
			if ipErr == nil && ip != "" {
				return droplet, nil
			}
		}
		select {
		case <-ctx.Done():
			return droplet, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (c *godoCloud) DeleteDroplet(ctx context.Context, server Server) error {
	_, err := c.client.Droplets.Delete(ctx, int(server.ID))
	return ignoreNotFound(err)
}

func (c *godoCloud) DeleteDropletsByTag(ctx context.Context, tag string) error {
	_, err := c.client.Droplets.DeleteByTag(ctx, tag)
	return ignoreNotFound(err)
}

func ignoreNotFound(err error) error {
	var apiErr *godo.ErrorResponse
	if errors.As(err, &apiErr) &&
		apiErr.Response != nil &&
		apiErr.Response.StatusCode == http.StatusNotFound {
		return nil
	}
	return err
}

func serverFromDroplet(droplet *godo.Droplet) Server {
	if droplet == nil {
		return Server{}
	}
	ip, _ := droplet.PublicIPv4()
	return Server{ID: int64(droplet.ID), Name: droplet.Name, IPv4: ip}
}
