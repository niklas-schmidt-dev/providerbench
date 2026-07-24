package hetzner

import (
	"context"
	"fmt"

	"github.com/hetznercloud/hcloud-go/v2/hcloud"
	"github.com/hetznercloud/hcloud-go/v2/hcloud/exp/actionutil"
)

type hcloudClient struct {
	client *hcloud.Client
}

// NewCloud creates the production Cloud implementation using Hetzner's
// maintained hcloud-go client. The token is kept out of command-line arguments.
func NewCloud(token, applicationVersion string) Cloud {
	return &hcloudClient{
		client: hcloud.NewClient(
			hcloud.WithToken(token),
			hcloud.WithApplication("providerbench", applicationVersion),
		),
	}
}

func (c *hcloudClient) ResolveSSHKey(ctx context.Context, name string) (int64, error) {
	key, _, err := c.client.SSHKey.GetByName(ctx, name)
	if err != nil {
		return 0, err
	}
	if key == nil {
		return 0, fmt.Errorf("SSH key not found")
	}
	return key.ID, nil
}

func (c *hcloudClient) CreatePlacementGroup(
	ctx context.Context,
	name string,
	labels map[string]string,
) (PlacementGroup, error) {
	result, _, err := c.client.PlacementGroup.Create(ctx, hcloud.PlacementGroupCreateOpts{
		Name:   name,
		Type:   hcloud.PlacementGroupTypeSpread,
		Labels: labels,
	})
	if err != nil {
		return PlacementGroup{}, err
	}
	if result.PlacementGroup == nil {
		return PlacementGroup{}, errorsNewMissingResource("placement group")
	}
	group := PlacementGroup{ID: result.PlacementGroup.ID, Name: result.PlacementGroup.Name}
	if err := c.client.Action.WaitFor(ctx, result.Action); err != nil {
		return group, err
	}
	return group, nil
}

func (c *hcloudClient) DeletePlacementGroup(ctx context.Context, group PlacementGroup) error {
	_, err := c.client.PlacementGroup.Delete(ctx, &hcloud.PlacementGroup{ID: group.ID})
	if hcloud.IsError(err, hcloud.ErrorCodeNotFound) {
		return nil
	}
	return err
}

func (c *hcloudClient) CreateServer(ctx context.Context, opts CreateServerOptions) (Server, error) {
	start := true
	result, _, err := c.client.Server.Create(ctx, hcloud.ServerCreateOpts{
		Name:       opts.Name,
		ServerType: &hcloud.ServerType{Name: opts.Plan},
		Image:      &hcloud.Image{Name: opts.Image},
		SSHKeys:    []*hcloud.SSHKey{{ID: opts.SSHKeyID}},
		Location:   &hcloud.Location{Name: opts.Region},
		PlacementGroup: &hcloud.PlacementGroup{
			ID: opts.PlacementGroupID,
		},
		Labels:           opts.Labels,
		StartAfterCreate: &start,
		PublicNet: &hcloud.ServerCreatePublicNet{
			EnableIPv4: true,
			EnableIPv6: true,
		},
	})
	if err != nil {
		return Server{}, err
	}
	if result.Server == nil {
		return Server{}, errorsNewMissingResource("server")
	}
	server := Server{
		ID:   result.Server.ID,
		Name: result.Server.Name,
		IPv4: serverIPv4(result.Server),
	}
	if err := c.client.Action.WaitFor(ctx, actionutil.AppendNext(result.Action, result.NextActions)...); err != nil {
		return server, err
	}
	created, _, err := c.client.Server.GetByID(ctx, result.Server.ID)
	if err != nil {
		return server, err
	}
	if created == nil {
		return server, errorsNewServerDisappeared(result.Server.ID)
	}
	return Server{
		ID:   created.ID,
		Name: created.Name,
		IPv4: serverIPv4(created),
	}, nil
}

func (c *hcloudClient) DeleteServer(ctx context.Context, server Server) error {
	result, _, err := c.client.Server.DeleteWithResult(ctx, &hcloud.Server{ID: server.ID})
	if hcloud.IsError(err, hcloud.ErrorCodeNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return c.client.Action.WaitFor(ctx, result.Action)
}

func errorsNewServerDisappeared(id int64) error {
	return fmt.Errorf("server %d disappeared after its create action completed", id)
}

func errorsNewMissingResource(resource string) error {
	return fmt.Errorf("Hetzner response did not include the created %s", resource)
}

func serverIPv4(server *hcloud.Server) string {
	if server == nil || server.PublicNet.IPv4.IsUnspecified() {
		return ""
	}
	return server.PublicNet.IPv4.IP.String()
}
